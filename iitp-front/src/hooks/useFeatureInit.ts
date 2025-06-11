import { useEffect } from "react";
import { usePTBusStationStore } from "@stores/usePTBusStationStore";
import { propertyFormSchema, PropertyFormSchemaProps } from "../component/form/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "../config/apiConfig";
import axiosInstance from "../api/axiosInstance";
import { FeatureStoreFactoryType } from "@stores/useFeatureStoreFactory";

// 각 도메인 별로 store를 생성하기 위함
export const menuCodeToStoreMap: Record<string, FeatureStoreFactoryType> = {
    // menuCode: store
    PT_BUS_STATION: usePTBusStationStore,
}

const useFeatureInit = () => {
    useEffect(() => {
        const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);

        const initMenuCodesFeature = async () => {
            for (const menuCode of menuCodes) {
                const store = menuCodeToStoreMap[menuCode];
                if (!store) continue;

                try {
                    const api = apiConfig[menuCode as ApiMenuKey].list;
                    const response = await axiosInstance({
                        method: api.method,
                        url: api.url,
                    });

                    // store를 동적으로 선언하기 때문에, store 메서드를 동적으로 호출
                    store.getState().setOriginData(response.data);
                    store.getState().initCurrentData()
                    console.log(`${menuCode} 데이터 초기화 완료`);
                } catch (err) {
                    console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
                } finally {
                    console.log(`[${menuCode}] originData:::`, store.getState().originData);
                }
            }
        };

        initMenuCodesFeature();
    }, []);
};

export default useFeatureInit;
