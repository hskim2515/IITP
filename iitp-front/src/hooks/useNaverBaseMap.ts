import { useEffect, useRef } from "react";
import { toLonLat } from "ol/proj";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { loadNaverMaps } from "@utils/naverMapLoader";

/**
 * 네이버 지도를 2D(OpenLayers) 배경으로 겹쳐 표시하고, OL view(팬/줌)를 네이버에 미러링한다.
 *
 * - 네이버는 **읽기 전용 배경** (자체 입력 비활성) → OL 이 유일한 입력 주체.
 * - OL center(EPSG:3857) → lonlat → 네이버 setCenter, OL zoom → 네이버 setZoom(정수 스냅).
 * - enabled=false 또는 키 미설정 시 네이버 미생성(기존 VWorld 배경 유지).
 *
 * @param containerRef 네이버 지도를 그릴 div (OL 컨테이너 바로 아래에 겹침)
 * @param enabled      네이버 배경 활성 여부 (배경지도 토글)
 */
export function useNaverBaseMap(
    containerRef: React.RefObject<HTMLDivElement | null>,
    enabled: boolean,
) {
    const olMap = useOpenLayersStore((s) => s.map);
    const olView = useOpenLayersStore((s) => s.view);
    const naverMapRef = useRef<any>(null);

    useEffect(() => {
        if (!enabled || !containerRef.current || !olView) return;
        let disposed = false;
        let onCenter: (() => void) | null = null;
        let onRes: (() => void) | null = null;

        loadNaverMaps().then((naver) => {
            if (disposed || !naver?.maps || !containerRef.current) return;

            // OL 현재 view → 네이버 초기값
            const toNaverLatLng = () => {
                const c = olView.getCenter();
                if (!c) return new naver.maps.LatLng(37.49720, 126.77496);
                const [lng, lat] = toLonLat(c);
                return new naver.maps.LatLng(lat, lng);
            };
            const toNaverZoom = () => Math.round(olView.getZoom() ?? 16);

            // 읽기 전용 배경: 자체 입력 전부 비활성 → OL 이 입력 주체
            const map = new naver.maps.Map(containerRef.current, {
                center: toNaverLatLng(),
                zoom: toNaverZoom(),
                draggable: false,
                scrollWheel: false,
                disableDoubleClickZoom: true,
                disableTwoFingerTapZoom: true,
                pinchZoom: false,
                keyboardShortcuts: false,
                mapDataControl: false,
                scaleControl: false,
                logoControl: true,   // 로고는 약관상 유지 필요
                zoomControl: false,
                minZoom: 6,
                maxZoom: 21,
            });
            naverMapRef.current = map;

            // OL → 네이버 동기화 (배경이므로 단방향)
            const sync = () => {
                if (disposed || !naverMapRef.current) return;
                naverMapRef.current.setCenter(toNaverLatLng());
                naverMapRef.current.setZoom(toNaverZoom(), false); // 애니메이션 없이 즉시(지터 방지)
            };
            onCenter = sync;
            onRes = sync;
            olView.on("change:center", sync);
            olView.on("change:resolution", sync);
            sync();
        });

        return () => {
            disposed = true;
            if (olView) {
                if (onCenter) olView.un("change:center", onCenter);
                if (onRes) olView.un("change:resolution", onRes);
            }
            if (naverMapRef.current) {
                try { naverMapRef.current.destroy?.(); } catch (_) {}
                naverMapRef.current = null;
            }
        };
    }, [enabled, olMap, olView, containerRef]);
}
