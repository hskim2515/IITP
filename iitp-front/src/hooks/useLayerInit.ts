import {useEffect} from "react";
import { propertyFormSchema, PropertyFormSchemaProps } from "../component/form/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "../config/apiConfig";
import axiosInstance from "../api/axiosInstance";
import { FeatureStoreFactoryType } from "@stores/useFeatureStoreFactory";
import {useNetworkStore} from "@stores/useNetworkStore";
import {useScenarioStore} from "@stores/useScenarioStore";
import VectorLayerManager from "@managers/VectorLayerManager";
import {useLayerStore} from "@stores/useLayerStore";
import TileLayerManager from "@managers/TileLayerManager";
import PrimitiveLayerManager from "@managers/PrimitiveLayerManager";
import DataSourceLayerManager from "@managers/DataSourceLayerManager";
import BaseMapLayerManager from "@managers/BaseMapLayerManager";
import {useSimulationStore} from "@stores/useSimulationStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import LayerManager from "@managers/LayerManager";
import {useLayerSchemaStore} from "@stores/useLayerSchemaStore";
import {assignPropertyToResponseData} from "@utils/guid";
import {usePavementMarkingStore} from "@stores/usePavementMarkingStore";
import { useBusStationStore } from "@stores/useBusStationStore";
import { useRailStationStore } from "@stores/useRailStationStore";

// 각 도메인 별로 store를 생성하기 위함
export const menuCodeToStoreMap: Record<string, FeatureStoreFactoryType> = {
    // menuCode: store
    NETWORK: useNetworkStore,
    BUS_STATION: useBusStationStore,
    RAIL_STATION: useRailStationStore,
    PAVEMENT_MARKING: usePavementMarkingStore,
}

export const layerNameToStoreMap: Record<string, FeatureStoreFactoryType> = {
    // layerName: store
    network: useNetworkStore,
    busStation: useBusStationStore,
    railStation: useRailStationStore,
    pavementMarking: usePavementMarkingStore,
}

const useLayerInit = (): void => {

    const olMap = useOpenLayersStore.state.map();
    const cesiumViewer = useCesiumStore.getState().viewer;
    const setLayerManager = useLayerStore.getState().setLayerManager;
    const lodLevels = [1.0, 0.5, 0.2];

    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);
    const layerGroups = useLayerSchemaStore.state.groups();

    useEffect(() => {
        if (olMap) {
            init()
        }

    }, [layerGroups, olMap, cesiumViewer]);

    const init = async () => {
        for (const menuCode of menuCodes) {
            const store = menuCodeToStoreMap[menuCode];
            if (!store) continue;

            try {
                const api = apiConfig[menuCode as ApiMenuKey].list;
                const response = await axiosInstance({
                    method: api.method,
                    url: api.url + '/' + selectedScenario.key,
                });

                store.getState().setOriginData(response.data);
                assignPropertyToResponseData(response.data, menuCode)
                store.getState().initCurrentData();

                console.log(`${menuCode} :::`,store.getState().originData)
                console.log(`${menuCode} 데이터 초기화 완료`);
            } catch (err) {
                console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
            } finally {
                console.log(`[${menuCode}] originData:::`, store.getState().originData);
            }
        }

        const vectorLayerManager = new VectorLayerManager(olMap, useLayerStore);
        const tileLayerManager = new TileLayerManager(olMap);
        const primitiveLayerManager = new PrimitiveLayerManager(cesiumViewer, useLayerStore);
        const dataSourceLayerManager = new DataSourceLayerManager(cesiumViewer, useLayerStore);
        const basemapLayerManager = new BaseMapLayerManager(cesiumViewer);

        const layerManager = new LayerManager(
            primitiveLayerManager,
            basemapLayerManager,
            cesiumViewer,
            vectorLayerManager,
            dataSourceLayerManager,
            tileLayerManager,
            olMap,
            useSimulationStore
        );

        setLayerManager(layerManager);
        layerManager.addBaseMapLayer(layerGroups);
        await layerManager.addFacilityLayers(layerGroups)
    };
};

export default useLayerInit;