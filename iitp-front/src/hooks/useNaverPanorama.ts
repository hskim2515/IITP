import { useEffect, useRef } from "react";
import { fromLonLat, toLonLat } from "ol/proj";
import { Feature } from "ol";
import { Point } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Icon } from "ol/style";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { loadNaverMaps } from "@utils/naverMapLoader";
import {
    type OnLink, buildAdjacency, buildLinkIndex, snapToLinks, advanceAlongLink,
} from "@utils/networkSnap";

const SNAP_MAX_METERS = 60;   // 이 거리 밖이면 스냅 안 함(자유 이동)
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
    const panoRef = useRef<any>(null);
    const markerLayerRef = useRef<any>(null);
    const onLinkRef = useRef<OnLink | null>(null);   // 현재 얹힌 링크 위 점(키보드 이동 기준)
    const lastPanRef = useRef<number>(0);            // pov.pan 마지막 유효값(Infinity 폴백)

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


            // ── 2D 위치+방향 마커 (거리뷰가 어디서 어느 방향을 보는지 표시) ──
            const markerFeature = new Feature({ geometry: new Point(fromLonLat([initLng, initLat])) });
            const markerStyle = new Style({
                image: new Icon({ src: PANO_MARKER_ICON, scale: 1.0, rotateWithView: true, rotation: 0 }),
            });
            markerFeature.setStyle(markerStyle);
            const markerLayer = new VectorLayer({ source: new VectorSource({ features: [markerFeature] }), zIndex: 9999 });
            markerLayerRef.current = markerLayer;
            if (olMap) olMap.addLayer(markerLayer);

            // 현재 뷰포트 네트워크 링크(타일 모드에서도 store 에 동기화됨)로 로드뷰 위치를 스냅.
            //   스냅되면 마커를 링크 선 위 점에 찍고 onLinkRef 갱신(키보드 이동 기준). 임계 밖이면 null.
            const snapToNetwork = (lng: number, lat: number): OnLink | null => {
                const links = useNetworkStore.getState().currentJsonData?.links ?? [];
                if (links.length === 0) return null;
                return snapToLinks(links, lng, lat, SNAP_MAX_METERS);
            };

            const updateMarker = () => {
                if (disposed || !panoRef.current) return;
                try {
                    const loc = panoRef.current.getLocation?.();
                    const coord = loc?.coord;
                    if (coord?.x != null && coord?.y != null) {
                        // 네트워크에 스냅되면 링크 선 위 점에, 아니면 로드뷰 실제 위치에 마커.
                        const snap = snapToNetwork(coord.x, coord.y);
                        onLinkRef.current = snap; // 없으면 null → 키보드 이동 시 재스냅 시도
                        const mx = snap ? snap.lng : coord.x;
                        const my = snap ? snap.lat : coord.y;
                        markerFeature.setGeometry(new Point(fromLonLat([mx, my])));
                    }
                    // ⚠️ Naver getPov().pan 이 Infinity 로 나오는 경우가 있다(tilt/fov 는 정상).
                    //   유효한 유한값일 때만 마커 방향 갱신(마지막 유효값 유지).
                    const pov = panoRef.current.getPov?.();
                    if (pov?.pan != null && Number.isFinite(pov.pan)) {
                        lastPanRef.current = pov.pan;
                        // 아이콘 부채꼴은 위(pan 0)를 향함 → pan(도, 시계) 을 라디안으로 회전.
                        (markerStyle.getImage() as Icon).setRotation((pov.pan * Math.PI) / 180);
                        markerFeature.changed();
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
            try {
                naver.maps.Event.addListener(pano, "pano_changed", () => {
                    if (disposed || syncing) return;
                    const loc = pano.getLocation?.();
                    const coord = loc?.coord; // {x:lng, y:lat}
                    if (!coord || coord.x == null || coord.y == null) return;
                    lastLng = coord.x; lastLat = coord.y;
                    syncing = true;
                    try { olView.setCenter(fromLonLat([coord.x, coord.y])); } catch (_) {}
                    setTimeout(() => { syncing = false; }, 50);
                });
            } catch (_) {}

            // ── 키보드 조작 (↑↓ 링크 따라 이동 / ←→ 시야 회전) ──
            const moveAlong = (meters: number) => {
                if (!panoRef.current) return;
                const links = useNetworkStore.getState().currentJsonData?.links ?? [];
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
                const next = advanceAlongLink(on, linkIndex, adjacency, meters, pan);
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
        };
    }, [enabled, olView, olMap, containerRef]);
}
