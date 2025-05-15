import HeatBarLayer from "@primitives/HeatBarLayer";
import ParabolicArrowPrimitive from "@primitives/ParabolicArrowPrimitive";
import FieldPrimitive from "@primitives/FieldPrimitive";
import TailPrimitive from "@primitives/TailPrimitive";
import DomePrimitive from "@primitives/DomePrimitive";
import { computeODMatrix, transformToTimeBasedPositions } from "@utils/transform";
import PrimitiveLayerManager from "./PrimitiveLayerManager";
import BaseMapLayerManager from "./BaseMapLayerManager";
import * as Cesium from "cesium";
import primitiveLayerManager from "./PrimitiveLayerManager";

type LayerItem = {
    id: number;
    key: string;
    label: string;
    basic: boolean;
    auth: number;
};

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

    constructor(
        private primitiveLayerManager: PrimitiveLayerManager,
        private baseMapLayerManager: BaseMapLayerManager,
        private viewer: Cesium.Viewer,
    ) {
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

    addHeatmapLayer(vehicleRoute: any[], speedFactor: number, isRunning: boolean, colors: any[], exaggeration: number) {
        //const timeBasedPositions = transformToTimeBasedPositions(vehicleRoute);
        const heatBarLayer = new HeatBarLayer(this.viewer, vehicleRoute, speedFactor, isRunning, colors, exaggeration);
        const group = this.primitiveLayerManager.add(heatBarLayer, "layer", "heatmap");
        this.layerGroups.set("layer", group);
    }

    removeHeatmapLayer() {
        this.primitiveLayerManager.remove("layer", "heatmap");
    }

    addODArrows(vehicleRoute: any[]) {
        // const odData = computeODMatrix(vehicleRoute);
        // odData.forEach(cell => {
        //     const arrow = new ParabolicArrowPrimitive(this.viewer.scene.context, cell.fromCenter, cell.toCenter, cell.density);
        //     const group = this.primitiveLayerManager.add(arrow, "layer", "od");
        //     this.layerGroups.set("layer", group);
        // });

        const arrow = new ParabolicArrowPrimitive(this.viewer.scene.context, vehicleRoute);
        const group = this.primitiveLayerManager.add(arrow, "layer", "od");
        this.layerGroups.set("layer", group);
    }

    removeODArrows() {
        this.primitiveLayerManager.remove("layer", "od");
    }

    addTripPrimitives(vehicleRoute: any[], speedFactor: number, isRunning: boolean) {

        this.primitiveLayerManager.add(new FieldPrimitive(vehicleRoute, this.viewer.scene.context, speedFactor, isRunning), "layer", "trip");
        this.primitiveLayerManager.add(new TailPrimitive(vehicleRoute, this.viewer.scene.context, speedFactor, isRunning), "layer", "trip");
        const group = this.primitiveLayerManager.add(new DomePrimitive(vehicleRoute, this.viewer.scene.context, speedFactor, isRunning), "layer", "default");
        this.layerGroups.set("layer", group);
        // vehicleRoute.forEach(position => {
        //     const flatArray = position.flatMap(({ x, y, z }) => [x, y, z]);
        //     const coords = Cesium.Cartesian3.fromDegreesArrayHeights(flatArray);
        //     this.primitiveLayerManager.add(new FieldPrimitive(coords, this.viewer.scene.context, speedFactor, isRunning), "layer", "trip");
        //     this.primitiveLayerManager.add(new TailPrimitive(coords, this.viewer.scene.context, speedFactor, isRunning), "layer", "trip");
        //     const group = this.primitiveLayerManager.add(new DomePrimitive(coords, this.viewer.scene.context, speedFactor, isRunning), "layer", "default");
        //     this.layerGroups.set("layer", group);
        // });
    }

    removeTripPrimitives() {
        this.primitiveLayerManager.remove("layer", "trip");
        this.primitiveLayerManager.remove("layer", "default"); // Dome은 default 그룹에 포함
    }

    addBaseMapLayer(schema: any[]) {
        if (!schema || !Array.isArray(schema)) return;
        const group = this.baseMapLayerManager.createBaseLayer(schema);
        this.layerGroups.set("baseMap", group);
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
        const results = this.getManagersByGroupAndLayerName(groupName, layerName)
            .map(manager => manager.get(groupName, layerName))
            .filter(layer => layer != null); // null/undefined 제거

        // 필요에 따라 첫 번째만 반환하거나 배열 전체 반환
        return results.length === 1 ? results[0] : results;
    }

    getManagersByGroupAndLayerName(groupName: string, layerName: string) {
        const group = this.layerGroups.get(groupName);
        const groups = [];
        if (group) {
            if(this.primitiveLayerManager.get(groupName, layerName)){
                groups.push(this.primitiveLayerManager)
            }
            if(this.baseMapLayerManager.get(groupName, layerName)){
                groups.push(this.baseMapLayerManager)
            }
        } else {
            console.log(`Group "${groupName}" does not exist.`);
        }
        return groups; // 레이어가 없으면 null 반환
    }

    getAllLayersByGroup(groupName: string) {
        return [...this.primitiveLayerManager.getAllByGroup(groupName),...this.baseMapLayerManager.getAllByGroup(groupName)];
    }

    getLayerGroup(groupName: string) {
        return this.getAllLayersByGroup(groupName);
    }

    removeSimulationLayers(){
        this.removeHeatmapLayer();
        this.removeTripPrimitives();
        this.removeODArrows();
    }
}

export default LayerManager;
