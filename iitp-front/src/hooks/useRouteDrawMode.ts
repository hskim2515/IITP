import { useEffect, useRef } from 'react';
import { useModeStore } from '@stores/useModeStore';
import { useSelectionStore } from '@stores/useSelectionStore';
import { useRouteDrawStore } from '@stores/useRouteDrawStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { FEATURE_TYPE } from '@type/Station';

/**
 * "노선 그리기" 모드 — 정류장/역을 지도에서 순서대로 클릭해 버스/철도 노선을 만든다.
 *
 * <p>usePlacementMode처럼 항상 마운트되는 훅이지만, 클릭을 새로 가로채지 않고 이미 안정화된
 * 기존 선택 파이프라인(useSelectionStore.selectedGuid — Cesium/OL 클릭 시 defaultEventHandler가
 * 채움)을 그대로 구독한다. CesiumEventAdapter는 여러 논리 이벤트가 같은 클릭 슬롯을 공유하는
 * 구조라(과거 "클릭 죽음" 버그 이력) 새 리스너를 얹기보다 기존 select 흐름을 재사용하는 편이
 * 안전하다 — 대신 정류장이 아닌 것을 클릭하면(다른 종류 엔티티) 조용히 무시한다.
 */
export function useRouteDrawMode(): void {
    const mode = useRouteDrawStore((s) => s.mode);
    const isEditMode = useModeStore((s) => s.appMode === 'edit');
    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const lastHandledGuidRef = useRef<string | null>(null);

    // 보기 모드로 전환되면(또는 전환 중 남아있으면) 그리기 상태를 정리 — usePlacementMode와 동일 이유.
    useEffect(() => {
        if (!isEditMode && mode !== 'none') {
            useRouteDrawStore.getState().reset();
        }
    }, [isEditMode, mode]);

    useEffect(() => {
        if (!isEditMode || mode === 'none') return;
        const guid = selectedGuid[0];
        if (typeof guid !== 'string' || guid === lastHandledGuidRef.current) return;
        lastHandledGuidRef.current = guid;

        if (mode === 'bus') {
            const station = useBusStationStore.getState().currentJsonData?.busStations
                ?.find((s: any) => s.__guid === guid);
            if (station?.featureType === FEATURE_TYPE.BUS_STATION && station.id != null) {
                useRouteDrawStore.getState().addStop({ guid, id: station.id, linkRef: station.linkRef });
            }
        } else if (mode === 'rail') {
            const station = useRailStationStore.getState().currentJsonData?.railStations
                ?.find((s: any) => s.__guid === guid);
            if (station?.featureType === FEATURE_TYPE.RAIL_STATION && station.id != null) {
                useRouteDrawStore.getState().addStop({ guid, id: station.id });
            }
        }
    }, [isEditMode, mode, selectedGuid]);

    // ESC로 그리기 취소 (usePlacementMode의 ESC 처리와 동일 패턴)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && useRouteDrawStore.getState().mode !== 'none') {
                useRouteDrawStore.getState().reset();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);
}
