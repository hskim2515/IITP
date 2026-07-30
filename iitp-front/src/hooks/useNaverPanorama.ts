import { useEffect, useRef } from "react";
import { fromLonLat, toLonLat } from "ol/proj";
import { Feature } from "ol";
import { Point } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Translate from "ol/interaction/Translate";
import { Style, Icon } from "ol/style";
import * as Cesium from "cesium";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useMapStore } from "@stores/useMapStore";
import { useModeStore } from "@stores/useModeStore";
import { useMessageStore } from "@stores/useMessageStore";
import { networkPrimitivePropertiesMap } from "@utils/networkPrimitiveShared";
import { loadNaverMaps } from "@utils/naverMapLoader";
import type { Link } from "@type/Network";
import {
    type OnLink, buildAdjacency, buildLinkIndex, snapToLinks, advanceAlongLink, bearing, destinationPoint,
} from "@utils/networkSnap";

const SNAP_MAX_METERS = 25;   // 이 거리 밖이면 스냅 안 함(자유 이동). 좁게 → 없는 도로에 잘못 붙는 것 방지
const KEY_MOVE_METERS = 15;   // ↑/↓ 한 번에 링크 따라 이동 거리
const KEY_ROTATE_DEG = 15;    // ←/→ 한 번에 시야 회전 각도

/** 거리뷰 위치 마커 아이콘 (canvas): 중심 점 + (옵션) 시야 부채꼴. 색상·부채꼴 유무 파라미터화. */
const makeMarkerIcon = (
    fan: [string, string, string] | null, dot: string,
): string => {
    const s = 120;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const ctx = c.getContext("2d")!;
    const cx = s / 2, cy = s / 2;
    const R = 52;
    if (fan) { // 시야 부채꼴(위=pan 0). 거리뷰 있을 때만.
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, -Math.PI / 2 - 0.7, -Math.PI / 2 + 0.7);
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        grad.addColorStop(0, fan[0]); grad.addColorStop(0.7, fan[1]); grad.addColorStop(1, fan[2]);
        ctx.fillStyle = grad; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = dot; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    return c.toDataURL();
};
const GREEN_FAN: [string, string, string] = ["rgba(90,230,140,0.95)", "rgba(50,200,100,0.5)", "rgba(50,200,100,0)"];
const ORANGE_FAN: [string, string, string] = ["rgba(255,210,60,0.95)", "rgba(255,170,30,0.55)", "rgba(255,170,30,0)"];
// 상태별 마커: 네트워크+거리뷰=초록(부채꼴) / 네트워크X+거리뷰=주황(부채꼴) /
//   네트워크+거리뷰X=초록(점만) / 둘다X=회색(점만)
const ICON_GREEN_FAN  = makeMarkerIcon(GREEN_FAN,  "#22c55e");
const ICON_ORANGE_FAN = makeMarkerIcon(ORANGE_FAN, "#ff8c1a");
const ICON_GREEN_DOT  = makeMarkerIcon(null,       "#22c55e");
const ICON_GRAY_DOT   = makeMarkerIcon(null,       "#8a8a90");

/**
 * 네이버 파노라마(거리뷰)를 3D 자리에 전경 표시. 기본 꺼짐 — useMapStore.roadviewEnabledInEdit
 * 를 사용자가 켜야(`enabled`) 나타난다.
 *
 * - 켤 때 위치: 그 순간의 2D center 로 1회만 초기화(부드러운 시작점, 이후 자동 추종 없음).
 * - 위치 재지정: 2D 지도 위의 마커를 드래그(ol/interaction/Translate)해 놓으면(translateend)
 *   그 지점으로 로드뷰가 이동한다 — 팬/줌마다 자동으로 따라오면 편집 중 거슬린다는 피드백으로,
 *   2D↔거리뷰 위치는 더 이상 지속적으로 동기화하지 않고 마커 드래그로만 명시적으로 옮긴다.
 * - 거리뷰 → 2D: 'pano_changed' (거리뷰 걷기) → olView.setCenter (사용자가 거리뷰 안에서
 *   직접 걸을 때만 발생 — 이건 사용자 의도가 분명하므로 유지).
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

    useEffect(() => {
        if (!enabled || !containerRef.current || !olView) return;
        // 파노라마가 Cesium 캔버스를 덮는 동안 useMapSync 의 Cesium→OL 동기화를 차단
        // (followCamera 의 프로그램적 카메라 이동이 사용자 조작으로 오인되어
        //  로드뷰가 끝없이 자동 이동하는 순환 방지)
        useMapStore.getState().setPanoramaActive(true);
        let disposed = false;
        let syncing = false;               // 루프 차단 guard
        let lastLng = 0, lastLat = 0;
        let removeKeyListener: (() => void) | null = null;
        let cleanupResize: (() => void) | null = null;
        let translateInteractionRef: Translate | null = null;

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

            // 분할↔단일 모드 전환·디바이더 드래그로 컨테이너 폭이 바뀌면 네이버 Panorama 는 자동
            //   리사이즈 안 됨 → ResizeObserver 로 setSize 갱신(안 하면 전환 후 파노라마가 안 채워짐).
            const roEl = containerRef.current;
            const resizeObs = new ResizeObserver(() => {
                if (disposed || !panoRef.current || !roEl) return;
                try { panoRef.current.setSize(new naver.maps.Size(roEl.clientWidth, roEl.clientHeight)); } catch (_) {}
            });
            try { resizeObs.observe(roEl); } catch (_) {}
            cleanupResize = () => { try { resizeObs.disconnect(); } catch (_) {} };

            // ── 거리뷰 없는 지점 처리 ──
            //   거리뷰 없음(pano_status ERROR): 이동은 막지 않음(마커는 그대로 이동), 다만 마커를 회색으로
            //     + 파노라마 화면을 마스킹(grayscale+어둡게)하고 경고. OK 로 돌아오면 원복.
            let noStreetview = false;
            let offNetwork = false;
            let lastWarnAt = 0;
            const warnThrottled = (text: string) => {
                const now = Date.now();
                if (now - lastWarnAt > 2500) { lastWarnAt = now; useMessageStore.getState().setMessage({ type: "warn", text }); }
            };
            const setMask = (on: boolean) => {
                if (!containerRef.current) return;
                containerRef.current.style.filter = on ? "grayscale(1) brightness(0.6)" : "";
            };
            try {
                naver.maps.Event.addListener(pano, "pano_status", (status: any) => {
                    const err = status === "ERROR";
                    if (err !== noStreetview) {
                        noStreetview = err;
                        setMask(err);
                        applyMarkerIcon();           // 회색/주황 전환
                        if (err) warnThrottled("이 구간은 거리뷰가 없습니다.");
                    }
                });
            } catch (_) {}


            // ── 2D 위치+방향 마커 ── 상태별 4색:
            //   네트워크+거리뷰=초록(부채꼴) / 네트워크X+거리뷰=주황(부채꼴) /
            //   네트워크+거리뷰X=초록(점만) / 둘다X=회색(점만). 부채꼴만 방향(pan) 회전.
            const markerFeature = new Feature({ geometry: new Point(fromLonLat([initLng, initLat])) });
            const mk = (src: string) => new Icon({ src, scale: 1.0, rotateWithView: true, rotation: 0 });
            const iconGreenFan = mk(ICON_GREEN_FAN), iconOrangeFan = mk(ICON_ORANGE_FAN);
            const iconGreenDot = mk(ICON_GREEN_DOT), iconGrayDot = mk(ICON_GRAY_DOT);
            const markerStyle = new Style({ image: iconGreenFan });
            let markerOnNetwork = true; // 현재 마커가 네트워크 위인지(updateMarker 가 갱신)
            // (onNetwork, noStreetview) 조합으로 아이콘 선택. 부채꼴 아이콘만 회전값 유지.
            const applyMarkerIcon = () => {
                const rot = (markerStyle.getImage() as Icon).getRotation?.() ?? 0;
                let img: Icon;
                if (!noStreetview) img = markerOnNetwork ? iconGreenFan : iconOrangeFan; // 거리뷰 있음 → 부채꼴
                else               img = markerOnNetwork ? iconGreenDot : iconGrayDot;  // 거리뷰 없음 → 점만
                if (!noStreetview) img.setRotation(rot); // 부채꼴만 방향 회전
                markerStyle.setImage(img);
                markerFeature.changed();
            };
            markerFeature.setStyle(markerStyle);
            const markerLayer = new VectorLayer({ source: new VectorSource({ features: [markerFeature] }), zIndex: 9999 });
            // 클릭/호버 히트 테스트에서 제외(마커는 항상 링크 위에 스냅되어 그 아래 링크/레인 선택을
            //   가릴 수 있음). defaultEventHandler 의 layerFilter 가 이 플래그를 보고 건너뜀.
            markerLayer.set("excludeFromHit", true);
            markerLayerRef.current = markerLayer;
            if (olMap) olMap.addLayer(markerLayer);

            // 마커를 드래그해 로드뷰 위치 재지정 — 드래그 도중엔 마커만 마우스를 따라가고(OL 기본
            // 동작), 놓는 순간(translateend)에만 실제 로드뷰를 그 위치로 이동시킨다(드래그 중 매
            // 프레임마다 파노라마 이미지를 새로 불러오면 낭비+ 끊김). 이동 후 pano_changed →
            // updateMarker 가 자동으로 실행돼 마커를 가까운 링크 위로 스냅(SNAP_MAX_METERS 이내)한다.
            const translateInteraction = new Translate({ layers: [markerLayer] });
            translateInteraction.on("translateend", (evt: any) => {
                const feat = evt.features?.item ? evt.features.item(0) : evt.features?.getArray?.()[0];
                const coord = feat?.getGeometry?.()?.getCoordinates?.();
                if (!coord) return;
                const [lng, lat] = toLonLat(coord) as [number, number];
                lastLng = lng; lastLat = lat;
                syncing = true;
                try { panoRef.current?.setPosition(new naver.maps.LatLng(lat, lng)); } catch (_) {}
                setTimeout(() => { syncing = false; }, 80);
            });
            if (olMap) olMap.addInteraction(translateInteraction);
            translateInteractionRef = translateInteraction;

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
                            // 네트워크에 스냅됨 → 마커를 링크 선 위 점에. onLinkRef 갱신(키보드 이동 기준).
                            onLinkRef.current = snap;
                            markerFeature.setGeometry(new Point(fromLonLat([snap.lng, snap.lat])));
                            offNetwork = false;
                            if (!markerOnNetwork) { markerOnNetwork = true; applyMarkerIcon(); } // 초록 전환
                        } else {
                            // 네트워크 없음(우리 도로망 밖) → 자유 이동 허용, 마커는 로드뷰 실제 위치.
                            //   키보드 링크 이동 기준 없음(onLinkRef null). 밖에 머무는 동안 재경고.
                            onLinkRef.current = null;
                            markerFeature.setGeometry(new Point(fromLonLat([coord.x, coord.y])));
                            offNetwork = true;
                            warnThrottled("네트워크가 없는 구역입니다.");
                            if (markerOnNetwork) { markerOnNetwork = false; applyMarkerIcon(); } // 주황 전환
                        }
                    }
                    // ⚠️ Naver getPov().pan 이 Infinity 로 나오는 경우가 있다(tilt/fov 는 정상).
                    //   유효한 유한값일 때만 마커 방향 갱신(부채꼴 아이콘에만; 점만 아이콘은 회전 무의미).
                    const pov = panoRef.current.getPov?.();
                    if (pov?.pan != null && Number.isFinite(pov.pan)) {
                        lastPanRef.current = pov.pan;
                        if (!noStreetview) { // 거리뷰 있을 때만 부채꼴 방향 회전
                            (markerStyle.getImage() as Icon).setRotation((pov.pan * Math.PI) / 180);
                            markerFeature.changed();
                        }
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

            // ⚠️ 예전엔 여기서 2D 팬/줌(change:center)마다, 그리고 도로 그리기 점을 확정할 때마다
            // 로드뷰 위치를 자동으로 따라 움직였는데, 편집 중 2D 지도를 이리저리 옮길 때마다 로드뷰가
            // 계속 텔레포트해 거슬린다는 피드백으로 제거했다(사용자 보고). 이제 로드뷰 위치는
            // (1) 켤 때 2D 중심으로 1회만 초기화되고, (2) 그 뒤로는 위 마커 드래그(Translate)로만
            // 사용자가 명시적으로 옮긴다.

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

            // ── 키보드 조작 (↑↓ 이동 / ←→ 시야 회전) ──
            //   네트워크 위: 링크 따라 이동(advanceAlongLink). 네트워크 밖: 보는 방향으로 직진 이동.
            const moveFree = (meters: number) => {
                // 네트워크 없는 구역: pov.pan(보는 방향)으로 meters 직진. ↓는 반대(뒤로).
                const loc = panoRef.current.getLocation?.();
                const c = loc?.coord;
                if (c?.x == null || c?.y == null) return;
                const pan = Number.isFinite(lastPanRef.current) ? lastPanRef.current : 0;
                const brg = meters >= 0 ? pan : (pan + 180) % 360;
                const dest = destinationPoint(c.x, c.y, brg, Math.abs(meters));
                warnThrottled("네트워크가 없는 구역입니다.");
                syncing = true;
                try { panoRef.current.setPosition(new naver.maps.LatLng(dest.lat, dest.lng)); } catch (_) {}
                try { markerFeature.setGeometry(new Point(fromLonLat([dest.lng, dest.lat]))); } catch (_) {}
                setTimeout(() => { syncing = false; }, 80);
            };
            const moveAlong = (meters: number) => {
                if (!panoRef.current) return;
                const links = currentLinks();
                // onLinkRef 없으면 현재 위치를 먼저 스냅해 기준점 확보
                let on = onLinkRef.current;
                if (!on && links.length > 0) {
                    const loc = panoRef.current.getLocation?.();
                    const c = loc?.coord;
                    if (c?.x != null && c?.y != null) on = snapToLinks(links, c.x, c.y, SNAP_MAX_METERS);
                }
                if (!on) { moveFree(meters); return; } // 네트워크 없음 → 보는 방향 직진
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
                // 편집모드에선 로드뷰는 참조용 → 화살표 키는 도로 편집과 충돌하므로 무시.
                if (useModeStore.getState().appMode === "edit") return;
                // 입력/텍스트 편집 중이면 무시(타이핑 방해 방지).
                const el = document.activeElement as HTMLElement | null;
                if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
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
            useMapStore.getState().setPanoramaActive(false);
            if (translateInteractionRef && olMap) { try { olMap.removeInteraction(translateInteractionRef); } catch (_) {} translateInteractionRef = null; }
            if (removeKeyListener) removeKeyListener();
            if (cleanupResize) cleanupResize();
            if (markerLayerRef.current && olMap) { try { olMap.removeLayer(markerLayerRef.current); } catch (_) {} markerLayerRef.current = null; }
            if (panoRef.current) {
                try { panoRef.current.destroy?.(); } catch (_) {}
                panoRef.current = null;
            }
            // 배경지도 변경/모드전환으로 파노라마 종료 시 2D 상태 원복:
            //   거리뷰 방향 동기화로 회전시킨 olView 를 0(북)으로 되돌린다(안 하면 2D 가 돌아간 채 남음).
            if (olView) { try { if ((olView.getRotation?.() ?? 0) !== 0) olView.setRotation(0); } catch (_) {} }
            // 거리뷰 없음 마스크(grayscale) 원복
            if (containerRef.current) { try { containerRef.current.style.filter = ""; } catch (_) {} }
            onLinkRef.current = null;
        };
    }, [enabled, olView, olMap, viewer, containerRef]);
}
