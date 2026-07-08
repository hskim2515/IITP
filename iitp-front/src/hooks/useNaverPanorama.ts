import { useEffect, useRef } from "react";
import { fromLonLat, toLonLat } from "ol/proj";
import { Feature } from "ol";
import { Point } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Icon } from "ol/style";
import * as Cesium from "cesium";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useMessageStore } from "@stores/useMessageStore";
import { networkPrimitivePropertiesMap } from "@datasource/NetworkDataSourceLayer";
import { loadNaverMaps } from "@utils/naverMapLoader";
import type { Link } from "@type/Network";
import {
    type OnLink, buildAdjacency, buildLinkIndex, snapToLinks, advanceAlongLink, bearing,
} from "@utils/networkSnap";

const SNAP_MAX_METERS = 25;   // 이 거리 밖이면 스냅 안 함(자유 이동). 좁게 → 없는 도로에 잘못 붙는 것 방지
const KEY_MOVE_METERS = 15;   // ↑/↓ 한 번에 링크 따라 이동 거리
const KEY_ROTATE_DEG = 15;    // ←/→ 한 번에 시야 회전 각도

/** 거리뷰 위치+방향 마커 아이콘 (canvas): 큰 시야 부채꼴 + 눈에 띄는 중심 점. */
const PANO_MARKER_ICON = (() => {
    const s = 120;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const ctx = c.getContext("2d")!;
    const cx = s / 2, cy = s / 2;
    const R = 52;
    // 시야 부채꼴 (위쪽 = pan 0). 넓고 진하게 + 외곽선으로 대비.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, -Math.PI / 2 - 0.7, -Math.PI / 2 + 0.7);
    ctx.closePath();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, "rgba(255,210,60,0.95)");
    grad.addColorStop(0.7, "rgba(255,170,30,0.55)");
    grad.addColorStop(1, "rgba(255,170,30,0)");
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.stroke();
    // 중심 점 (크고 흰 테두리 + 그림자로 배경 대비)
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#ff8c1a"; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    return c.toDataURL();
})();

/**
 * 네이버 파노라마(거리뷰)를 3D 자리에 전경 표시하고, 2D(OpenLayers) 지도와 **위치 양방향 동기화**한다.
 *
 * - 2D center 는 "위에서 본 지점" = 거리뷰 위치와 개념이 일치(조감 3D 와 달리 안정적).
 * - 2D → 거리뷰: olView 'change:center' (팬/줌) → panorama.setPosition (디바운스 + 거리 임계).
 * - 거리뷰 → 2D: 'pano_changed' (거리뷰 걷기) → olView.setCenter.
 * - guard flag 로 무한 루프 차단 (useMapSync 패턴).
 * - 방향(pan/tilt)은 사용자가 거리뷰에서 직접 조작(읽기전용 아님). 위치만 동기화.
 */
export function useNaverPanorama(
    containerRef: React.RefObject<HTMLDivElement | null>,
    enabled: boolean,
) {
    const olView = useOpenLayersStore((s) => s.view);
    const olMap = useOpenLayersStore((s) => s.map);
    const viewer = useCesiumStore((s) => s.viewer);
    const panoRef = useRef<any>(null);
    const markerLayerRef = useRef<any>(null);
    const onLinkRef = useRef<OnLink | null>(null);   // 현재 얹힌 링크 위 점(키보드 이동 기준)
    const lastPanRef = useRef<number>(0);            // pov.pan 마지막 유효값(Infinity 폴백)
    const lastSnapRef = useRef<{ lng: number; lat: number } | null>(null); // 마지막 네트워크 스냅 위치(되돌림용)

    useEffect(() => {
        if (!enabled || !containerRef.current || !olView) return;
        let disposed = false;
        let syncing = false;               // 루프 차단 guard
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let lastLng = 0, lastLat = 0;
        let onOlCenter: (() => void) | null = null;
        let removeKeyListener: (() => void) | null = null;

        loadNaverMaps().then((naver) => {
            if (disposed || !naver?.maps?.Panorama || !containerRef.current) {
                if (!naver?.maps?.Panorama) console.warn("[naverPano] Panorama 미로드");
                return;
            }

            // 시작 위치: 2D center (없으면 기본 부천)
            const center = olView.getCenter();
            const ll = center ? toLonLat(center) : [126.77496, 37.49720];
            const initLng = ll[0] ?? 126.77496, initLat = ll[1] ?? 37.49720;
            lastLng = initLng; lastLat = initLat;

            const pano = new naver.maps.Panorama(containerRef.current, {
                position: new naver.maps.LatLng(initLat, initLng),
                pov: { pan: 0, tilt: 0, fov: 100 },
                visible: true,
                logoControl: true,
                zoomControl: true,
                aroundControl: true,        // 거리뷰 걷기(위치 이동)
                keyboardShortcuts: false,   // 네이버 자체 키 끔 → 우리가 화살표로 링크 따라 이동/회전
            });
            panoRef.current = pano;

            // ── 거리뷰 없는 지점 처리: 마지막 유효 위치 유지 + 경고 ──
            //   네이버는 반경 내 파노라마 없으면 pano_status='ERROR'. 그 위치로는 이동하지 않고
            //   직전 유효 위치로 되돌린다("이전 위치 유지"). 경고 토스트로 사용자에게 알림.
            let lastValidLat = initLat, lastValidLng = initLng;
            let noStreetWarnedAt = 0;
            try {
                naver.maps.Event.addListener(pano, "pano_status", (status: any) => {
                    if (status === "ERROR") {
                        const now = Date.now();
                        if (now - noStreetWarnedAt > 2000) { // 연타 경고 방지
                            noStreetWarnedAt = now;
                            useMessageStore.getState().setMessage({ type: "warn", text: "이 구간은 거리뷰가 없습니다." });
                        }
                        syncing = true;
                        try { pano.setPosition(new naver.maps.LatLng(lastValidLat, lastValidLng)); } catch (_) {}
                        setTimeout(() => { syncing = false; }, 80);
                        return;
                    }
                    // OK: 현재 위치를 마지막 유효 위치로 기록
                    const loc = pano.getLocation?.();
                    const c = loc?.coord;
                    if (c?.x != null && c?.y != null) { lastValidLng = c.x; lastValidLat = c.y; }
                });
            } catch (_) {}


            // ── 2D 위치+방향 마커 (거리뷰가 어디서 어느 방향을 보는지 표시) ──
            const markerFeature = new Feature({ geometry: new Point(fromLonLat([initLng, initLat])) });
            const markerStyle = new Style({
                image: new Icon({ src: PANO_MARKER_ICON, scale: 1.0, rotateWithView: true, rotation: 0 }),
            });
            markerFeature.setStyle(markerStyle);
            const markerLayer = new VectorLayer({ source: new VectorSource({ features: [markerFeature] }), zIndex: 9999 });
            // 클릭/호버 히트 테스트에서 제외(마커는 항상 링크 위에 스냅되어 그 아래 링크/레인 선택을
            //   가릴 수 있음). defaultEventHandler 의 layerFilter 가 이 플래그를 보고 건너뜀.
            markerLayer.set("excludeFromHit", true);
            markerLayerRef.current = markerLayer;
            if (olMap) olMap.addLayer(markerLayer);

            // 스냅 소스: 3D(Cesium) 네트워크가 그린 링크 지오메트리(networkPrimitivePropertiesMap).
            //   로드뷰는 3D 모드 기능이라, 3D 에 렌더된 링크가 정확한 소스(2D store 는 3D 에선 빈 채).
            //   각 entry 는 { ...link, featureType } → featureType==='links' 만, coordinates/fromNode/toNode 보유.
            const currentLinks = (): Link[] => {
                const out: Link[] = [];
                for (const props of networkPrimitivePropertiesMap.values()) {
                    if (props?.featureType === "links" && Array.isArray(props.coordinates) && props.coordinates.length >= 2) {
                        out.push(props as Link);
                    }
                }
                return out;
            };
            // 로드뷰 위치를 링크 선 위 최근접점으로 스냅. 마커를 그 점에 찍고 onLinkRef 갱신(키보드 기준).
            const snapToNetwork = (lng: number, lat: number): OnLink | null => {
                const links = currentLinks();
                if (links.length === 0) return null;
                return snapToLinks(links, lng, lat, SNAP_MAX_METERS);
            };

            // 로드뷰가 이동하면 Cesium 카메라도 그 지점으로(디바운스) → 3D 네트워크가 그 위치에 로드되어
            //   스냅 소스(networkPrimitivePropertiesMap)가 채워진다. useMapSync 는 OL 사용자 조작일 때만
            //   카메라를 옮겨(isOLSyncing guard) 로드뷰 setCenter 로는 안 따라오므로 직접 옮긴다.
            let camTimer: ReturnType<typeof setTimeout> | null = null;
            const followCamera = (lng: number, lat: number) => {
                if (!viewer || viewer.isDestroyed?.()) return;
                if (camTimer) clearTimeout(camTimer);
                camTimer = setTimeout(() => {
                    camTimer = null;
                    if (disposed) return;
                    try {
                        const cam = viewer.camera;
                        cam.setView({
                            destination: Cesium.Cartesian3.fromDegrees(lng, lat, cam.positionCartographic.height),
                            orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
                        });
                    } catch (_) {}
                }, 250); // 연속 이동 정착 후 1회 (타일 재로딩 과다 방지)
            };

            const updateMarker = () => {
                if (disposed || !panoRef.current) return;
                try {
                    const loc = panoRef.current.getLocation?.();
                    const coord = loc?.coord;
                    if (coord?.x != null && coord?.y != null) {
                        followCamera(coord.x, coord.y); // Cesium 카메라가 로드뷰 따라가 3D 네트워크 로드
                        const snap = snapToNetwork(coord.x, coord.y);
                        if (snap) {
                            // 네트워크에 스냅됨 → 마커를 링크 선 위 점에, 마지막 유효 위치 기록.
                            onLinkRef.current = snap;
                            lastSnapRef.current = { lng: snap.lng, lat: snap.lat };
                            markerFeature.setGeometry(new Point(fromLonLat([snap.lng, snap.lat])));
                        } else if (lastSnapRef.current && !syncing) {
                            // 임계 내 네트워크 없음 → 로드뷰를 마지막 스냅 위치로 되돌림(네트워크 고정,
                            //   자유 이동으로 벗어나거나 무한 이동하는 것 방지).
                            const back = lastSnapRef.current;
                            syncing = true;
                            try { panoRef.current.setPosition(new naver.maps.LatLng(back.lat, back.lng)); } catch (_) {}
                            setTimeout(() => { syncing = false; }, 80);
                            return; // 방향 갱신은 되돌린 뒤 다음 이벤트에서
                        } else {
                            // 아직 한 번도 스냅 안 됨(초기) → 로드뷰 실제 위치에 마커
                            markerFeature.setGeometry(new Point(fromLonLat([coord.x, coord.y])));
                        }
                    }
                    // ⚠️ Naver getPov().pan 이 Infinity 로 나오는 경우가 있다(tilt/fov 는 정상).
                    //   유효한 유한값일 때만 마커 방향 갱신(마지막 유효값 유지).
                    const pov = panoRef.current.getPov?.();
                    if (pov?.pan != null && Number.isFinite(pov.pan)) {
                        lastPanRef.current = pov.pan;
                        // 아이콘 부채꼴은 위(pan 0)를 향함 → pan(도, 시계) 을 라디안으로 회전.
                        (markerStyle.getImage() as Icon).setRotation((pov.pan * Math.PI) / 180);
                        markerFeature.changed();
                        // 거리뷰 방향 → 2D 지도 방향 동기화: 로드뷰가 보는 쪽이 2D 에서 위(북)로 오도록
                        //   olView 를 회전. OL rotation 은 반시계(+)라 pan(시계) 을 부호 반전. syncing 중엔 스킵.
                        if (!syncing && olView.getRotation) {
                            try {
                                const target = (-pov.pan * Math.PI) / 180;
                                if (Math.abs((olView.getRotation() ?? 0) - target) > 0.02) olView.setRotation(target);
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
            };
            try {
                naver.maps.Event.addListener(pano, "pov_changed", updateMarker);   // 방향 회전
                naver.maps.Event.addListener(pano, "pano_changed", updateMarker);  // 위치 이동
            } catch (_) {}
            updateMarker();

            // ── 2D → 거리뷰 (팬/줌 정착 후 디바운스, 거리 임계) ──
            const syncPanoFromOl = () => {
                if (disposed || syncing || !panoRef.current) return;
                const c = olView.getCenter();
                if (!c) return;
                const ll2 = toLonLat(c);
                const lng = ll2[0] ?? 0, lat = ll2[1] ?? 0;
                // 이동 거리(대략 m): 20m 미만이면 스킵(미세 이동 무시)
                const dx = (lng - lastLng) * 88000, dy = (lat - lastLat) * 111000;
                if (dx * dx + dy * dy < 20 * 20) return;
                lastLng = lng; lastLat = lat;
                syncing = true;
                try { panoRef.current.setPosition(new naver.maps.LatLng(lat, lng)); } catch (_) {}
                setTimeout(() => { syncing = false; }, 50); // pano_changed 반향 흡수
            };
            onOlCenter = () => {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(syncPanoFromOl, 300); // 연속 팬/줌 정착 후 1회
            };
            olView.on("change:center", onOlCenter);

            // ── 거리뷰 → 2D (거리뷰에서 걸으면 2D center 이동) ──
            //   ⚠️ 거리 임계 없이 매 pano_changed 마다 setCenter 하면 2D↔로드뷰 가 미세 진동(churn)해
            //     OL 이 계속 재중심화 → singleclick 이 안 뜬다(2D 클릭 죽음). 15m 이상일 때만 반영.
            try {
                naver.maps.Event.addListener(pano, "pano_changed", () => {
                    if (disposed || syncing) return;
                    const loc = pano.getLocation?.();
                    const coord = loc?.coord; // {x:lng, y:lat}
                    if (!coord || coord.x == null || coord.y == null) return;
                    const dx = (coord.x - lastLng) * 88000, dy = (coord.y - lastLat) * 111000;
                    if (dx * dx + dy * dy < 15 * 15) return; // 미세 이동 무시 → churn 방지
                    lastLng = coord.x; lastLat = coord.y;
                    syncing = true;
                    try { olView.setCenter(fromLonLat([coord.x, coord.y])); } catch (_) {}
                    setTimeout(() => { syncing = false; }, 80);
                });
            } catch (_) {}

            // ── 키보드 조작 (↑↓ 링크 따라 이동 / ←→ 시야 회전) ──
            const moveAlong = (meters: number) => {
                if (!panoRef.current) return;
                const links = currentLinks();
                if (links.length === 0) return;
                // onLinkRef 없으면 현재 위치를 먼저 스냅해 기준점 확보
                let on = onLinkRef.current;
                if (!on) {
                    const loc = panoRef.current.getLocation?.();
                    const c = loc?.coord;
                    if (c?.x != null && c?.y != null) on = snapToLinks(links, c.x, c.y, SNAP_MAX_METERS);
                }
                if (!on) return; // 근처에 네트워크 없음
                const linkIndex = buildLinkIndex(links);
                const adjacency = buildAdjacency(links);
                const pan = Number.isFinite(lastPanRef.current) ? lastPanRef.current : NaN;
                // 방향 정정: advanceAlongLink 의 +meters 는 링크 좌표 순서(fromNode→toNode)로 전진하는데,
                //   로드뷰가 보는 방향(pan)이 그 반대면 ↑ 가 뒤로 간다. 현재 세그먼트의 진행 방위와 pan 을
                //   비교해, 시야와 반대 방향이면 meters 부호를 뒤집어 "↑=보는 쪽 전진"이 되게 한다.
                let signed = meters;
                const curLink = linkIndex.get(on.linkId);
                if (curLink && Number.isFinite(pan)) {
                    const c = curLink.coordinates;
                    const a = c[on.segIndex], b = c[on.segIndex + 1] ?? a;
                    if (a && b) {
                        const segBrg = bearing({ lng: a.lng, lat: a.lat }, { lng: b.lng, lat: b.lat });
                        const d = Math.abs(((segBrg - pan) % 360 + 360) % 360);
                        const diff = d > 180 ? 360 - d : d;
                        if (diff > 90) signed = -meters; // 링크 순서가 시야와 반대 → 부호 반전
                    }
                }
                const next = advanceAlongLink(on, linkIndex, adjacency, signed, pan);
                onLinkRef.current = next;
                syncing = true; // setPosition→pano_changed 반향 흡수
                try { panoRef.current.setPosition(new naver.maps.LatLng(next.lat, next.lng)); } catch (_) {}
                try { markerFeature.setGeometry(new Point(fromLonLat([next.lng, next.lat]))); } catch (_) {}
                setTimeout(() => { syncing = false; }, 80);
            };
            const rotateView = (deltaDeg: number) => {
                if (!panoRef.current) return;
                try {
                    const pov = panoRef.current.getPov?.() ?? {};
                    const base = Number.isFinite(pov.pan) ? pov.pan : lastPanRef.current;
                    const pan = ((base + deltaDeg) % 360 + 360) % 360;
                    lastPanRef.current = pan;
                    panoRef.current.setPov({ pan, tilt: pov.tilt ?? 0, fov: pov.fov ?? 100 });
                } catch (_) {}
            };
            const onKeyDown = (e: KeyboardEvent) => {
                if (disposed || !panoRef.current) return;
                switch (e.key) {
                    case "ArrowUp":    e.preventDefault(); moveAlong(KEY_MOVE_METERS); break;
                    case "ArrowDown":  e.preventDefault(); moveAlong(-KEY_MOVE_METERS); break;
                    case "ArrowLeft":  e.preventDefault(); rotateView(-KEY_ROTATE_DEG); break;
                    case "ArrowRight": e.preventDefault(); rotateView(KEY_ROTATE_DEG); break;
                }
            };
            window.addEventListener("keydown", onKeyDown);
            removeKeyListener = () => window.removeEventListener("keydown", onKeyDown);
        });

        return () => {
            disposed = true;
            if (debounceTimer) clearTimeout(debounceTimer);
            if (removeKeyListener) removeKeyListener();
            if (onOlCenter && olView) olView.un("change:center", onOlCenter);
            if (markerLayerRef.current && olMap) { try { olMap.removeLayer(markerLayerRef.current); } catch (_) {} markerLayerRef.current = null; }
            if (panoRef.current) {
                try { panoRef.current.destroy?.(); } catch (_) {}
                panoRef.current = null;
            }
            // 배경지도 변경/모드전환으로 파노라마 종료 시 2D 상태 원복:
            //   거리뷰 방향 동기화로 회전시킨 olView 를 0(북)으로 되돌린다(안 하면 2D 가 돌아간 채 남음).
            if (olView) { try { if ((olView.getRotation?.() ?? 0) !== 0) olView.setRotation(0); } catch (_) {} }
            onLinkRef.current = null;
            lastSnapRef.current = null;
        };
    }, [enabled, olView, olMap, viewer, containerRef]);
}
