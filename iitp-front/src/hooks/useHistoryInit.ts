import { useEffect } from "react";
import { propertyFormSchema, PropertyFormSchemaProps } from "../component/form/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "../config/apiConfig";
import axiosInstance from "../api/axiosInstance";
import {usePavementMarkingHistoryStore} from "@stores/usePavementMarkingStore";
import {HistoryStoreFactoryType} from "@stores/useHistoryStoreFactory";
import {useScenarioStore} from "@stores/useScenarioStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useBusStationStore } from "@stores/useBusStationStore";

// 각 도메인 별로 store를 생성하기 위함
export const menuCodeToHistoryStoreMap: Record<string, HistoryStoreFactoryType> = {
    // menuCode: store
    NETWORK: useNetworkStore,
    BUS_STATION: useBusStationStore,
    PAVEMENT_MARKING: usePavementMarkingHistoryStore,
}

const useHistoryInit = () => {
    useEffect(() => {
        const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);
        const selectedScenario = useScenarioStore.getState().selectedScenario;
        const initMenuCodesHistory = async () => {
            for (const menuCode of menuCodes) {
                const store = menuCodeToHistoryStoreMap[menuCode];
                if (!store) continue;

                try {
                    const api = apiConfig[menuCode as ApiMenuKey].historyList;
                    const response = await axiosInstance({
                        method: api.method,
                        url: api.url + '/' + selectedScenario.key,
                    });
                    console.log("[useHistoryInit] response:::", response)
                    // store를 동적으로 선언하기 때문에, store 메서드를 동적으로 호출
                    store.getState().setOriginHistoryData(response.data);
                    //store.getState().initCurrentData()
                    console.log(`${menuCode} 데이터 초기화 완료`);
                } catch (err) {
                    console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
                } finally {
                    console.log(`[${menuCode}] originData:::`, store.getState().originHistoryData);
                }
            }
        };

        initMenuCodesHistory();
    }, []);
};

export default useHistoryInit;
