import { useEffect, useRef } from "react";
import { toLonLat } from "ol/proj";
import { unByKey } from "ol/Observable";
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
    const syncRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!enabled || !containerRef.current || !olView) return;
        let disposed = false;
        let onCenter: (() => void) | null = null;
        let onRes: (() => void) | null = null;
        let onRot: (() => void) | null = null;
        let cleanupResize: (() => void) | null = null;
        const hiddenBaseLayers: any[] = []; // 네이버 위해 숨긴 OL 배경타일 (복원용)
        let layerAddKey: any = null;

        // 네이버가 배경으로 보이도록 OL 의 baseMap 타일 레이어를 숨긴다 (OL 이 위에서 가리지 않게).
        // baseMap 레이어는 스키마 로드 후 나중에 추가되므로, 현재 것 + 이후 add 이벤트 둘 다 처리.
        const hideBaseLayer = (l: any) => {
            // baseMap 레이어가 현재 보이는 상태일 때만 숨기고 복원 대상에 기록
            if (l && l["layerGroup"] === "baseMap" && l.getVisible?.()) {
                l.setVisible(false);
                hiddenBaseLayers.push(l);
            }
        };
        // ⚠️ TileLayer 는 addLayer 직후 layer["layerGroup"]="baseMap" 마킹이 붙는다(add 이벤트 시점엔
        //    아직 undefined). 따라서 add 시 즉시가 아니라 **다음 tick(마킹 완료 후)** 전체 baseMap 을
        //    숨긴다. 스키마 로드 지연도 대비해 여러 번 저비용 재확인.
        const hideAllBaseLayers = () => {
            if (!olMap || disposed) return;
            try { olMap.getLayers().forEach((l: any) => hideBaseLayer(l)); } catch (_) {}
        };
        if (olMap) {
            try {
                hideAllBaseLayers();
                setTimeout(hideAllBaseLayers, 0);
                layerAddKey = olMap.getLayers().on("add", () => setTimeout(hideAllBaseLayers, 0));
                setTimeout(hideAllBaseLayers, 500);
                setTimeout(hideAllBaseLayers, 1500);
            } catch (_) {}
        }

        loadNaverMaps().then((naver) => {
            if (disposed || !naver?.maps || !containerRef.current) return;

            // OL 현재 view → 네이버 초기값.
            // ⚠️ Naver SDK 는 인증(도메인/키) 실패 시 **로드 후에** naver.maps 를 무효화한다
            // → sync 시점마다 재확인. null 반환 시 sync 는 조용히 스킵.
            const toNaverLatLng = () => {
                if (!naver?.maps?.LatLng) return null;
                const c = olView.getCenter();
                if (!c) return new naver.maps.LatLng(37.49720, 126.77496);
                const [lng, lat] = toLonLat(c);
                return new naver.maps.LatLng(lat, lng);
            };
            // 네이버 줌은 내림(floor) — sync 의 scale 보정이 항상 확대(≥1)가 되어 여백이 없다.
            const toNaverZoom = () => Math.floor(olView.getZoom() ?? 16);

            const initCenter = toNaverLatLng();
            if (!initCenter) return; // 인증 실패 등으로 SDK 무효 → 네이버 배경 생략

            // 읽기 전용 배경: 자체 입력 전부 비활성 → OL 이 입력 주체
            const map = new naver.maps.Map(containerRef.current, {
                center: initCenter,
                zoom: toNaverZoom(),
                mapTypeId: naver.maps.MapTypeId?.HYBRID ?? "hybrid", // 위성 영상 + 도로/지명 라벨 오버레이
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

            // 분할 폭 변경(디바이더 드래그)·모드 전환으로 컨테이너 크기가 바뀌면 naver.maps.Map 은
            //   자동 리사이즈 안 됨 → 내부 뷰포트가 옛 크기라 지도가 잘리고 배율이 어긋난다.
            //   ResizeObserver 로 setSize + 재동기화(sync)로 새 크기에 맞춘다.
            const roEl = containerRef.current;
            const resizeObs = new ResizeObserver(() => {
                if (disposed || !naverMapRef.current || !roEl) return;
                try {
                    naverMapRef.current.setSize(new naver.maps.Size(roEl.clientWidth, roEl.clientHeight));
                    syncRef.current?.();
                } catch (_) {}
            });
            try { resizeObs.observe(roEl); } catch (_) {}
            cleanupResize = () => { try { resizeObs.disconnect(); } catch (_) {} };

            // OL → 네이버 동기화 (배경이므로 단방향).
            // ⚠️ 이 리스너는 OL view 이벤트 체인에서 실행되고, 그 체인은 Cesium 카메라 동기화
            // (useMapSync) 안에서도 발화한다 — 여기서 예외가 새면 **Cesium 렌더 루프가 정지**
            // ("Rendering has stopped" 실사고). 반드시 try/catch 로 격리.
            const sync = () => {
                if (disposed || !naverMapRef.current) return;
                try {
                    const center = toNaverLatLng();
                    if (!center) return; // SDK 무효화(인증 실패) → 스킵
                    naverMapRef.current.setCenter(center);

                    // 축척 정합: 네이버는 정수 줌만 지원하나 OL 은 연속 줌(16.4 등)이라, 정수로 반올림하면
                    // 배경이 벡터와 어긋난다. 네이버 줌을 내림(floor)하고, OL 연속 줌과의 차이를
                    // CSS transform scale 로 메워 배율을 정확히 맞춘다(항상 ≥1 → 여백 없음).
                    const zOl = olView.getZoom() ?? 16;
                    const zNaver = Math.floor(zOl);
                    const scale = Math.pow(2, zOl - zNaver); // ∈ [1, 2)
                    naverMapRef.current.setZoom(zNaver, false);

                    // 회전 정합: 네이버는 회전 API 가 제한적이라, OL view rotation(라디안, useMapSync 가
                    // Cesium heading 을 setRotation 으로 반영)을 CSS transform rotate 로 배경에 적용한다.
                    // 회전: OL rotation 을 CSS rotate 로 배경에 적용. 방향은 실측으로 rot(부호 반전 없이)가 일치.
                    const rot = olView.getRotation() ?? 0;
                    if (containerRef.current) {
                        containerRef.current.style.transformOrigin = "center center";
                        containerRef.current.style.transform = `rotate(${rot}rad) scale(${scale})`;
                    }
                } catch (err) {
                    console.warn('[naverMap] sync 실패 (무시):', err);
                }
            };
            syncRef.current = sync;
            onCenter = sync;
            onRes = sync;
            onRot = sync;
            olView.on("change:center", sync);
            olView.on("change:resolution", sync);
            olView.on("change:rotation", sync); // Cesium 회전 → OL rotation → 네이버 배경 rotate
            sync();
        });

        return () => {
            disposed = true;
            if (cleanupResize) cleanupResize();
            syncRef.current = null;
            if (olView) {
                if (onCenter) olView.un("change:center", onCenter);
                if (onRes) olView.un("change:resolution", onRes);
                if (onRot) olView.un("change:rotation", onRot);
            }
            if (naverMapRef.current) {
                try { naverMapRef.current.destroy?.(); } catch (_) {}
                naverMapRef.current = null;
            }
            // add 이벤트 구독 해제
            if (layerAddKey) { try { unByKey(layerAddKey); } catch (_) {} }
            // 네이버 위해 숨겼던 OL 배경타일 복원 (네이버 off/언마운트 시 VWorld 복귀)
            hiddenBaseLayers.forEach((l) => { try { l.setVisible(true); } catch (_) {} });
        };
    }, [enabled, olMap, olView, containerRef]);
}
