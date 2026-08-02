import { useEffect} from "react";
import * as Cesium from "cesium";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import throttle from 'lodash/throttle';
import { useSelectionStore } from "@stores/useSelectionStore";
import {defaultEventHandlers} from "@handler/defaultEventHandler";

const useDefaultMoveMouse = () => {

    const viewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map)

    const olManager = useEventStore((state) => state.olEventManager);
    const cesiumManager = useEventStore((state) => state.cesiumEventManager);

    const selectedGuid = useSelectionStore((state) => state.selectedGuid)

    const THROTTLE_MS = 16
    const OL_HOVER_THROTTLE_MS = 48

    // const hoverLayerName = useMemo(() => {
    //     if (!activeSubmenu) {
    //         return undefined;
    //     }
    //     return propertyFormSchema[activeSubmenu.menuCode].layer;
    // }, [activeSubmenu]);

    useEffect(() => {
        if (!olMap || !olManager) return;

        // (구) throttle(debounce(100ms)) 는 마우스가 멈춘 뒤에야 발화해 이동 중에는
        // 호버·3D 미러가 전혀 동작하지 않았다 ("2D-3D 동기화가 때때로 안 됨"의 원인).
        // 핸들러가 대상 변경 시에만 일하도록 가벼워졌으므로 일반 throttle 로 상시 발화.
        const optimizedOlHover = throttle(defaultEventHandlers.handleOlHover, OL_HOVER_THROTTLE_MS);

        olManager.bind("pointermove", optimizedOlHover);

        return () => {
            optimizedOlHover.cancel();
            olManager.unbind("pointermove", optimizedOlHover);
        };
    }, [olMap, olManager, selectedGuid]);

    useEffect(() => {
        if (!viewer || !cesiumManager) return;
        const throttledCesiumHover = throttle(defaultEventHandlers.handleCesiumHover, THROTTLE_MS);
        // Cesium ScreenSpaceEventHandler 는 MOUSE_MOVE 이벤트 객체(및 내부 Cartesian2)를
        // 재사용·변이(mutate)한다 — throttle trailing 호출이 그 참조를 나중에 읽으면
        // 처리 시점의 좌표가 이벤트 발생 시점과 어긋나 "호버가 한 대상 늦는" 원인이 된다.
        // 좌표를 즉시 값으로 복사(snapshot)해 throttled 함수에 넘긴다.
        const snapshotCesiumHover = (e: any) => {
            const raw = e?.endPosition ?? e?.position;
            if (!raw || !isFinite(raw.x) || !isFinite(raw.y)) return;
            throttledCesiumHover({ endPosition: new Cesium.Cartesian2(raw.x, raw.y) });
        };
        cesiumManager.bind("move", snapshotCesiumHover);
        return () => {
            cesiumManager.unbind("move", snapshotCesiumHover);
            throttledCesiumHover.cancel()
        };
    }, [viewer, cesiumManager, selectedGuid]);

};

export default useDefaultMoveMouse;