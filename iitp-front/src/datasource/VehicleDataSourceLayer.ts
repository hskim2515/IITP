import { GeoJsonDataSource, Viewer } from "cesium";
import * as Cesium from "cesium";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {useScenarioStore} from "@stores/useScenarioStore";
import {useVehicleStore} from "@stores/useVehicleStore";
import {useRef} from "react";

export default class VehicleDataSourceLayer {
    private readonly LAYER_NAME = "vehicle";


    constructor(private viewer: Viewer, private dataSource: Cesium.CzmlDataSource) {
        this.load()
    }

    public async load(): Promise<Cesium.CzmlDataSource | undefined> {

        try {


            return this.dataSource;

        } catch (error) {
            console.error("VehicleDataSourceLayer.load() 중 에러 발생:", error);
        }
    }



}
