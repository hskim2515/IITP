import { useEffect } from 'react';
import { useSelectionStore } from '@stores/useSelectionStore';
import { useMenuStore } from '@stores/useMenuStore';
import { useMessageStore } from '@stores/useMessageStore';
import { useBusStationStore, useBusStationHistoryStore } from '@stores/useBusStationStore';
import { useRailStationStore, useRailStationHistoryStore } from '@stores/useRailStationStore';
import { useSignalStore, useSignalHistoryStore } from '@stores/useSignalStore';
import { modifyFeatureEventHandlers } from '@handler/modifyFeatureEventHandlers';
import { extractFeatureTypeFromGuid } from '@utils/guid';

const STATION_FEATURE_TYPES = new Set(['busStations', 'railStations', 'exits', 'signals']);

const STATION_TYPE_TO_STORE = {
    busStations: { store: useBusStationStore, history: useBusStationHistoryStore },
    railStations: { store: useRailStationStore, history: useRailStationHistoryStore },
    exits: { store: useRailStationStore, history: useRailStationHistoryStore },
    signals: { store: useSignalStore, history: useSignalHistoryStore },
} as const;

/**
 * PropertyPanel 없이 도로편집 컨텍스트에서 시설물(버스정류장/지하철정류장/신호)의
 * 드래그 이동 및 Delete 키 삭제를 활성화한다.
 */
const useNetworkStationModify = () => {
    const selectedGuid = useSelectionStore((state) => state.selectedGuid);
    const activeSubmenu = useMenuStore((state) => state.activeSubmenu);

    // selectedGuid에 시설물 타입이 포함되면 modifyFeatureEventHandlers 활성화
    useEffect(() => {
        // PropertyPanel이 열려 있으면 PropertyPanel이 이미 처리함
        if (activeSubmenu) return;

        const stationFeatureTypes = new Set<string>(
            (selectedGuid ?? [])
                .map((g) => extractFeatureTypeFromGuid(g as string))
                .filter((v): v is string => !!v && STATION_FEATURE_TYPES.has(v))
        );

        if (stationFeatureTypes.size === 0) return;

        const disposers: Array<() => void> = [];
        stationFeatureTypes.forEach((featureType) => {
            const dispose = modifyFeatureEventHandlers(featureType);
            if (typeof dispose === 'function') disposers.push(dispose);
        });

        return () => {
            [...disposers].reverse().forEach((d) => { try { d(); } catch {} });
        };
    }, [selectedGuid, activeSubmenu]);

    // Delete 키로 선택된 시설물 삭제
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Delete') return;
            if (activeSubmenu) return;

            const guids = useSelectionStore.getState().selectedGuid as string[];
            if (!guids?.length) return;

            const stationGuids = guids.filter((g) => {
                const ft = extractFeatureTypeFromGuid(g);
                return ft && STATION_FEATURE_TYPES.has(ft);
            });
            if (!stationGuids.length) return;

            // 각 스토어별로 분류하여 삭제
            const grouped: Record<string, string[]> = {};
            stationGuids.forEach((g) => {
                const ft = extractFeatureTypeFromGuid(g);
                if (ft) {
                    grouped[ft] = grouped[ft] ?? [];
                    grouped[ft].push(g);
                }
            });

            Object.entries(grouped).forEach(([ft, guidList]) => {
                const entry = STATION_TYPE_TO_STORE[ft as keyof typeof STATION_TYPE_TO_STORE];
                if (!entry) return;
                entry.store.getState().removeRecordsByGuid(guidList, entry.history as any);
            });

            useSelectionStore.getState().clearSelected();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `${stationGuids.length}개 항목이 삭제되었습니다.`,
            });
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [activeSubmenu]);
};

export default useNetworkStationModify;
