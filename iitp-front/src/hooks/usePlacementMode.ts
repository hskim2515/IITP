import { useEffect, useRef } from 'react';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useEditGuideStore } from '@stores/useEditGuideStore';
import { createEventHandlers } from '@handler/createEventHandlers';
import { generateGUIDWithType } from '@utils/guid';

/**
 * 시설물 배치 모드(버스정류장/지하철역/신호) 클릭 리스너 + ESC 취소.
 *
 * <p>버튼 자체는 Facility.tsx(레이어 팝업의 "시설물" 탭)에 있지만, 이 훅은 항상 마운트되는
 * Maps.tsx에서 호출한다 — Facility.tsx는 레이어 팝업이 열려있고 그 탭이 활성일 때만
 * 렌더되므로, 만약 리스너를 거기 두면 배치 모드를 켠 채로 팝업을 닫거나 다른 탭으로
 * 넘어가는 순간(placementMode 상태는 그대로인데) 클릭 리스너와 ESC 핸들러가 함께 사라져
 * 지도가 먹통이 되는 문제가 있었다(구 NetworkDrawPanel도 같은 구조라 원래 있던 문제).
 */
export function usePlacementMode(): void {
    const placementMode = useNetworkDrawStore((s) => s.placementMode);
    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (placementMode === 'none') {
            cleanupRef.current?.();
            cleanupRef.current = null;
            return;
        }

        const featureTypeMap = {
            busStation: 'busStations',
            railStation: 'railStations',
            signal: 'signals',
        } as const;
        const featureType = featureTypeMap[placementMode];
        const guid = generateGUIDWithType(featureType);

        const placementLabel = { busStation: '버스 정류장', railStation: '철도역', signal: '신호등' }[placementMode];
        useEditGuideStore.getState().setGuide({
            title: `시설물 배치 — ${placementLabel}`,
            steps: [
                { keys: ['클릭'], text: `지도에서 ${placementLabel}을(를) 놓을 위치를 클릭하세요`, em: true },
                { keys: ['ESC'], text: '배치 종료 → 선택 모드로 복귀' },
            ],
            tip: '배치 후 속성 창에서 상세 정보를 수정할 수 있어요.',
        });

        const record: Record<string, any> = { featureType, __guid: guid, id: Date.now() };
        if (placementMode === 'signal') {
            record.turning = 'Straight';
            record.type = 'TrafficLight';
        }

        const handlerCleanup = createEventHandlers(record);

        // 대상 스토어 구독: 새 항목이 추가되면 배치 모드 종료 → 선택 모드로 복귀(모드 버튼이
        // 없으므로 배치가 끝났는데도 아무 모드로도 안 돌아가면 그다음 클릭이 아무 반응이 없다).
        const targetStore = { busStation: useBusStationStore, railStation: useRailStationStore, signal: useSignalStore }[placementMode];
        const getCount = (data: any) => Object.values(data ?? {}).flat().length;
        const prevCount = getCount(targetStore.getState().currentJsonData);
        const unsubscribe = (targetStore as any).subscribe(
            (state: any) => state.currentJsonData,
            (data: any) => {
                if (getCount(data) > prevCount) useNetworkDrawStore.getState().exitToSelect();
            },
            { equalityFn: (a: any, b: any) => a === b }
        );

        cleanupRef.current = () => {
            handlerCleanup?.();
            unsubscribe();
            useEditGuideStore.getState().clear();
        };

        return () => {
            cleanupRef.current?.();
            cleanupRef.current = null;
        };
    }, [placementMode]);

    // ESC 키로 배치 모드 취소 → 선택 모드로 복귀
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && useNetworkDrawStore.getState().placementMode !== 'none') {
                useNetworkDrawStore.getState().exitToSelect();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);
}
