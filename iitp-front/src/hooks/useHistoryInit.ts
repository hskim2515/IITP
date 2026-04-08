import { useEffect } from "react";
import { propertyFormSchema, PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import {usePavementMarkingHistoryStore} from "@stores/usePavementMarkingStore";
import {HistoryStoreFactoryType} from "@stores/useHistoryStoreFactory";
import {useScenarioStore} from "@stores/useScenarioStore";
import {useNetworkHistoryStore} from "@stores/useNetworkStore";
import {useBusStationHistoryStore} from "@stores/useBusStationStore";
import { useRailStationHistoryStore } from "@stores/useRailStationStore";
import {useSignalHistoryStore} from "@stores/useSignalStore";
import { useSignalTodHistoryStore } from "@stores/useSignalTodStore";
import { useSimulationScenarioHistoryStore } from "@stores/useSimulationScenarioStore";
import { useBusPtLineHistoryStore, useBusPtLineWeekdayHistoryStore, useBusPtLineWeekendHistoryStore } from "@stores/useBusPtLineStore";
import { useRailPtLineHistoryStore } from "@stores/useRailPtLineStore";

// 각 도메인 별로 store를 생성하기 위함
export const menuCodeToHistoryStoreMap: Record<string, HistoryStoreFactoryType> = {
    // menuCode: store
    NETWORK: useNetworkHistoryStore,
    BUS_STATION: useBusStationHistoryStore,
    RAIL_STATION: useRailStationHistoryStore,
    PAVEMENT_MARKING: usePavementMarkingHistoryStore,
    SIGNAL: useSignalHistoryStore,
    SIGNAL_TOD: useSignalTodHistoryStore,
    SIMULATION_SCENARIO: useSimulationScenarioHistoryStore,
    BUS_PT_LINE: useBusPtLineHistoryStore,
    BUS_PT_LINE_WEEKDAY: useBusPtLineWeekdayHistoryStore,
    BUS_PT_LINE_WEEKEND: useBusPtLineWeekendHistoryStore,
    RAIL_PT_LINE: useRailPtLineHistoryStore,
}
export const layerNameToHistoryStoreMap: Record<string, HistoryStoreFactoryType> = {
    // layerName: store
    network: useNetworkHistoryStore,
    busStation: useBusStationHistoryStore,
    railStation: useRailStationHistoryStore,
    pavementMarking: usePavementMarkingHistoryStore,
    signal: useSignalHistoryStore,
    signalTod: useSignalTodHistoryStore,
    busRoute: useBusPtLineHistoryStore,
    busRouteWeekday: useBusPtLineWeekdayHistoryStore,
    busRouteWeekend: useBusPtLineWeekendHistoryStore,
    railRoute: useRailPtLineHistoryStore,
}

const useHistoryInit = (reloadFlag:boolean) => {
    useEffect(() => {

        const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);
        const selectedScenario = useScenarioStore.getState().selectedScenario;
        const selectedScenarioVersion = useScenarioStore.getState().selectedScenarioVersion;
        const initMenuCodesHistory = async () => {
            for (const menuCode of menuCodes) {
                const store = menuCodeToHistoryStoreMap[menuCode];
                if (!store) continue;

                try {
                    const api = (apiConfig[menuCode as ApiMenuKey] as any)?.historyList;
                    if (!api) continue;
                    const response = await axiosInstance({
                        method: api.method,
                        url: api.url + '/' + (selectedScenarioVersion?.key ?? selectedScenario.key),
                    });

                    // store를 동적으로 선언하기 때문에, store 메서드를 동적으로 호출
                    store.getState().setOriginHistoryData(response.data);
                    //store.getState().initCurrentData()
                    console.log(`${menuCode} 데이터 초기화 완료`);
                    console.log(`${menuCode} response data:::`, response.data);
                } catch (err) {
                    console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
                } finally {
                    console.log(`[${menuCode}] originData:::`, store.getState().originHistoryData);
                }
            }
        };

        initMenuCodesHistory();
    }, [reloadFlag]);
};

export default useHistoryInit;
