import HeatBarLayer from "@primitives/HeatBarLayer";
import ParabolicArrowPrimitive from "@primitives/ParabolicArrowPrimitive";
import FieldPrimitive from "@primitives/FieldPrimitive";
import TailPrimitive from "@primitives/TailPrimitive";
import DomePrimitive from "@primitives/DomePrimitive";
import PrimitiveLayerManager from "./PrimitiveLayerManager";
import BaseMapLayerManager from "./BaseMapLayerManager";
import * as Cesium from "cesium";
import { Map as OLMap } from "ol";
import TileLayerManager from "./TileLayerManager";
import VectorLayerManager from "./VectorLayerManager";
import HeatmapLayer from "@features/HeatmapLayer";
import BaseLayer from "ol/layer/Base";
import ODMatrixLayer from "@features/ODMatrixLayer";
import VehicleLayer from "@features/VehicleLayer";
import TrailLayer from "@features/TrailLayer";
import NetworkLayer from "@features/NetworkLayer";
import BusStationLayer from "@features/BusStationLayer";

type LayerItem = {
    id: number;
    key: string;
    label: string;
    basic: boolean;
    auth: number;
};

type Manager = PrimitiveLayerManager | BaseMapLayerManager | VectorLayerManager | TileLayerManager;

type LayerGroupSchema = {
    id: number;
    key: string;
    label: string;
    fields?: LayerItem[];
    layers?: LayerItem[]; // fields 대신 layers가 올 수도 있으니 둘 다 처리
};

// LayerGroup 관리가 포함된 LayerManager
export class LayerManager {

    private layerGroups: Map<string, any> = new Map();
    private managers: Manager[] = [];

    constructor(
        private primitiveLayerManager: PrimitiveLayerManager,
        private baseMapLayerManager: BaseMapLayerManager,
        private cesiumViewer: Cesium.Viewer,
        private vectorLayerManager: VectorLayerManager,
        private tileLayerManager: TileLayerManager,
        private olMap: OLMap,
        private simulationStore: any
    ) {
        this.managers = [ primitiveLayerManager, baseMapLayerManager, vectorLayerManager, tileLayerManager ]
    }

    // 레이어 그룹에서 레이어 제거
    removeLayerFromGroup(groupName: string, layerName: string) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            group.layers = group.layers.filter(layer => layer.layerName !== layerName);
        } else {
            console.log(`Group "${groupName}" does not exist.`);
        }
    }

    // 그룹 이름으로 레이어들 가져오기
    getLayersFromGroup(groupName: string) {
        const group = this.layerGroups.get(groupName);
        return group ? group.layers : [];
    }

    // === 레이어 추가 및 제거 ===

    addHeatmapLayer(vehicleRoute: any[], vectorSource, speedFactor: number, isRunning: boolean, heatmapSetting) {
        const { colors, exaggeration, blur } = heatmapSetting;
        const groupName = "layer"
        const layerName = "heatmap"

        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        //const timeBasedPositions = transformToTimeBasedPositions(vehicleRoute);
        const heatBarLayer = new HeatBarLayer(this.cesiumViewer, vehicleRoute, speedFactor, isRunning, colors, exaggeration);
        const primitiveCollections: Cesium.PrimitiveCollection = this.primitiveLayerManager.add(heatBarLayer, groupName, layerName);
        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);
        if (!managedCollection.includes(primitiveCollections)) {
            managedCollection.push(primitiveCollections);
        }
        //ol
        const olHeatmap = new HeatmapLayer(vehicleRoute, vectorSource, speedFactor, isRunning, colors, blur);
        const layers = this.vectorLayerManager.add(olHeatmap, groupName, layerName);

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })
    }

    removeHeatmapLayer() {
        this._removeLayers("layer", "heatmap");
    }

    addODArrows(vehicleRoute: any[], speedFactor: number, isRunning: boolean) {
        const groupName = "layer";
        const layerName = "od";
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);
        // const odData = computeODMatrix(vehicleRoute);
        // odData.forEach(cell => {
        //     const arrow = new ParabolicArrowPrimitive(this.viewer.scene.context, cell.fromCenter, cell.toCenter, cell.density);
        //     const group = this.primitiveLayerManager.add(arrow, "layer", "od");
        //     this.layerGroups.set("layer", group);
        // });

        const arrow = new ParabolicArrowPrimitive(this.cesiumViewer.scene.context, vehicleRoute);
        const primitiveCollections = this.primitiveLayerManager.add(arrow, groupName, layerName);

        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);
        if (!managedCollection.includes(primitiveCollections)) {
            managedCollection.push(primitiveCollections);
        }

        const odLayer = new ODMatrixLayer(vehicleRoute, speedFactor, isRunning);
        const layers = this.vectorLayerManager.add(odLayer, groupName, layerName);
        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })
    }

    removeODArrows(): void {
        this._removeLayers("layer", "od");
    }

    addTripLayer(vehicleRoute: any[], speedFactor: number, isRunning: boolean) {
        const groupName = "layer"
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        this.primitiveLayerManager.add(new FieldPrimitive(vehicleRoute, this.cesiumViewer.scene.context, speedFactor, isRunning), groupName, "trip");
        this.primitiveLayerManager.add(new TailPrimitive(vehicleRoute, this.cesiumViewer.scene.context, speedFactor, isRunning), groupName, "trip");
        const primitiveCollections = this.primitiveLayerManager.add(new DomePrimitive(vehicleRoute, this.cesiumViewer.scene.context, speedFactor, isRunning), groupName, "default");
        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);
        if (!managedCollection.includes(primitiveCollections)) {
            managedCollection.push(primitiveCollections);
        }

        // vehicleRoute.forEach(position => {
        //     const flatArray = position.flatMap(({ x, y, z }) => [x, y, z]);
        //     const coords = Cesium.Cartesian3.fromDegreesArrayHeights(flatArray);
        //     this.primitiveLayerManager.add(new FieldPrimitive(coords, this.viewer.scene.context, speedFactor, isRunning), "layer", "trip");
        //     this.primitiveLayerManager.add(new TailPrimitive(coords, this.viewer.scene.context, speedFactor, isRunning), "layer", "trip");
        //     const group = this.primitiveLayerManager.add(new DomePrimitive(coords, this.viewer.scene.context, speedFactor, isRunning), "layer", "default");
        //     this.layerGroups.set("layer", group);
        // });

        const tripLayer = new TrailLayer(vehicleRoute, speedFactor, isRunning)
        const layers = this.vectorLayerManager.add(tripLayer, groupName, "trip");

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })

    }

    removeTripLayer(): void {
        this._removeLayers("layer", "trip","default"); // trip + default
    }

    addVehicleLayer(vehicleRoute, vectorSource, speedFactor, isRunning) {
        const groupName = "layer"
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);
        const vehicleLayer = new VehicleLayer(vehicleRoute, vectorSource, speedFactor, isRunning);
        const layers = this.vectorLayerManager.add(vehicleLayer, groupName, "vehicle");

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })

        console.log("this.layerGroups.addVehicleLayer:::", this.layerGroups)
    }
    removeVehicleLayer(): void {
        this._removeLayers("layer", "vehicle");
    }

    addBusStationLayer() {

        const groupName = "edit";
        const layerName = "PT_BUS_STATION"

        const layerGroup: Record<string, BaseLayer[]> = (this.layerGroups.get(groupName) || {});
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        //ol
        const busStation = new BusStationLayer();
        const layers = this.vectorLayerManager.add(busStation, groupName, layerName);

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })
        busStation.loadFromStore();
    }

    async addNetworkLayer() {
        const groupName = "edit";
        const layerName = "NETWORK"

        const layerGroup = this.layerGroups.get(groupName) || {};
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        //ol
        const network = new NetworkLayer();
        const layers = this.vectorLayerManager.add(network, groupName, layerName);

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })
        await network.load();
    }

    addBaseMapLayer(schema: any[]) {
        if (!Array.isArray(schema) || schema.length === 0) return;
        const groupName = "baseMap";
        const baseMapLayerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;

        if (!this.layerGroups.has(groupName)) {
            this.layerGroups.set(groupName, baseMapLayerGroup);
        }

        //manager 리스트 기반, 배경지도 manager의 createBaseLayer 호출
        (this.managers as Manager[]).forEach((manager) => {
            if (!(manager instanceof BaseMapLayerManager || manager instanceof TileLayerManager)) return;
            if (typeof manager.createBaseLayer !== "function") return;
            const layers = manager.createBaseLayer(schema) as any[];
            const key = manager.getId();
            const baseMapValue = (baseMapLayerGroup[key] ||= []);
            layers.forEach((layer) => {
                if (!baseMapValue.includes(layer)) {
                    baseMapValue.push(layer);
                }
            })
        });
        console.log("this.layerGroups.addBaseMapLayer:::", this.layerGroups);
    }

    // === 레이어 그룹 관련 기능 ===

    // 특정 그룹의 모든 레이어 제거
    removeAllLayersFromGroup(groupName: string) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            group.layers.forEach(({ layer }) => {
                this.primitiveLayerManager.remove("layer", layer);
            });
            group.layers = [];
        } else {
            console.log(`Group "${groupName}" does not exist.`);
        }
    }

    // 그룹별 레이어 보이기/숨기기
    toggleLayerVisibilityInGroup(groupName: string, layerName: string, isVisible: boolean) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            const layer = group.layers.find(l => l.layerName === layerName);
            if (layer) {
                layer.layer.setVisibility(isVisible);
            } else {
                console.log(`Layer "${layerName}" not found in group "${groupName}".`);
            }
        } else {
            console.log(`Group "${groupName}" does not exist.`);
        }
    }

    // 그룹 내 모든 레이어를 보이게 설정
    showAllLayersInGroup(groupName: string) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            group.layers.forEach(({ layer }) => {
                layer.setVisibility(true); // setVisibility 메서드가 레이어에 있어야 함
            });
        } else {
            console.log(`Group "${groupName}" does not exist.`);
        }
    }

    // 그룹 내 모든 레이어를 숨기게 설정
    hideAllLayersInGroup(groupName: string) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            group.layers.forEach(({ layer }) => {
                layer.setVisibility(false); // setVisibility 메서드가 레이어에 있어야 함
            });
        } else {
            console.log(`Group "${groupName}" does not exist.`);
        }
    }

    // 개별 레이어 보이기
    showLayer(groupName: string, layerName: string) {
        this.getManagersByGroupAndLayerName(groupName, layerName).forEach((manager) => {
            manager.show(groupName, layerName);
        })
    }

    // 개별 레이어 숨기기
    hideLayer(groupName: string, layerName: string) {
        this.getManagersByGroupAndLayerName(groupName, layerName).forEach((manager) => {
            manager.hide(groupName, layerName);
        })
    }

    // groupName과 layerName으로 레이어 가져오기
    getLayer(groupName: string, layerName: string) {
        const manager = this.getManagersByGroupAndLayerName(groupName, layerName)
            .flatMap((manager) => { // 이중 배열 평탄화 [[HeatBarLayer],[Heatmap]] => [HeatBarLayer,Heatmap]
                const res = manager.get(groupName, layerName);
                return Array.isArray(res) ? res : res ? [res] : [];
            });
        // 하나면 단일 객체, 여러 개면 배열
        return manager.length === 1 ? manager[0] : manager;
    }

    getManagersByGroupAndLayerName(groupName: string, layerName: string): Manager[] {
            return this.managers.filter((manager: any) => {
                if (typeof manager.get !== "function") return false;
                const res = manager.get(groupName, layerName);
                return Array.isArray(res) ? res.length > 0 : !!res;
            });
        }


    getAllLayersByGroup(groupName: string) {
        const result = [
            ...this.primitiveLayerManager.getAllByGroup(groupName),
            ...this.baseMapLayerManager.getAllByGroup(groupName),
            ...this.vectorLayerManager.getAllByGroup(groupName),
            // ...this.tileLayerManager.getAllByGroup(groupName),
        ]
        return result;
    }

    getLayerGroup(groupName: string) {
        return this.getAllLayersByGroup(groupName);
    }

    getLayerByName(layerName: string) {
        return this.vectorLayerManager.getLayerByName(layerName)
    }

    private _removeLayers(groupName: string, ...layers: string[]): void {
        layers.forEach((layerName) => {
            this.getManagersByGroupAndLayerName(groupName, layerName).forEach((manager) => {
                if (typeof manager.remove === "function") {
                    manager.remove(groupName, layerName);
                }
            });
        });
    }

    removeSimulationLayers() {
        this.removeHeatmapLayer();
        this.removeTripLayer();
        this.removeODArrows();
        this.removeVehicleLayer()
    }
}

export default LayerManager;
