import HeatBarLayer from "@primitives/HeatBarLayer";
import ParabolicArrowPrimitive from "@primitives/ParabolicArrowPrimitive";
import TailPrimitive from "@primitives/TailPrimitive";
import VehiclePrimitive from "@primitives/VehiclePrimitive";
import SpeedHeatmapLayer from "@primitives/SpeedHeatmapLayer";
import TrafficHeatmapCesiumLayer from "@primitives/TrafficHeatmapCesiumLayer";
import SpeedHeatmapOlLayer from "@features/SpeedHeatmapOlLayer";
import PrimitiveLayerManager from "./PrimitiveLayerManager";
import BaseMapLayerManager from "./BaseMapLayerManager";
import * as Cesium from "cesium";
import { Map as OLMap } from "ol";
import TileLayerManager from "./TileLayerManager";
import VectorLayerManager from "./VectorLayerManager";
import HeatmapFeatureLayer from "@features/HeatmapFeatureLayer";
import BaseLayer from "ol/layer/Base";
import ODMatrixFeatureLayer from "@features/ODMatrixFeatureLayer";
import VehicleFeatureLayer from "@features/VehicleFeatureLayer";
import TrailFeatureLayer from "@features/TrailFeatureLayer";
import TrafficHeatmapFeatureLayer from "@features/TrafficHeatmapFeatureLayer";
import DataSourceLayerManager from "@managers/DataSourceLayerManager";
import VehicleDataSourceLayer from "../datasource/VehicleDataSourceLayer";
import VectorSource from "ol/source/Vector";

type LayerItem = {
    id: number;
    key: string;
    label: string;
    basic: boolean;
    auth: number;
};

type Manager =
    PrimitiveLayerManager
    | BaseMapLayerManager
    | VectorLayerManager
    | TileLayerManager
    | DataSourceLayerManager;

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
        private dataSourceLayerManager: DataSourceLayerManager,
        private tileLayerManager: TileLayerManager,
        private olMap: OLMap,
        private simulationStore: any
    ) {
        this.managers = [ primitiveLayerManager, baseMapLayerManager, vectorLayerManager, tileLayerManager, dataSourceLayerManager ]
    }

    // 레이어 그룹에서 레이어 제거
    removeLayerFromGroup(groupName: string, layerName: string) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            group.layers = group.layers.filter(layer => layer.layerName !== layerName);
        } else {
            console.log(`Group "${ groupName }" does not exist.`);
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
        const groupName = "analyze"
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
        const olHeatmap = new HeatmapFeatureLayer(vehicleRoute, vectorSource, speedFactor, isRunning, colors, blur);
        const layers = this.vectorLayerManager.add(olHeatmap, groupName, layerName, heatmapSetting.basic);

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })
    }

    removeHeatmapLayer() {
        this._removeLayers("analyze", "heatmap");
    }

    addODArrows(vehicleRoute: any[], speedFactor: number, isRunning: boolean) {
        const groupName = "analyze";
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

        const odLayer = new ODMatrixFeatureLayer(vehicleRoute, speedFactor, isRunning);
        const layers = this.vectorLayerManager.add(odLayer, groupName, layerName, false);
        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })
    }

    removeODArrows(): void {
        this._removeLayers("analyze", "od");
    }

    addTripLayer(vehicleRoute: any[], speedFactor: number, isRunning: boolean, typeGroups?: Map<string, any[]>, vehicleTypeArray?: string[]) {
        const groupName = "analyze"
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        const tailPaths = vehicleRoute.map((entry: any) => Array.isArray(entry) ? entry : entry.path);
        this.primitiveLayerManager.add(new TailPrimitive(tailPaths, this.cesiumViewer.scene.context, speedFactor, isRunning, vehicleTypeArray ?? []), groupName, "trip");
        // 속도 히트맵 레이어: Cesium 3D
        const primitiveCollections = this.primitiveLayerManager.add(new SpeedHeatmapLayer(this.cesiumViewer), groupName, "speed");
        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);
        if (!managedCollection.includes(primitiveCollections)) {
            managedCollection.push(primitiveCollections);
        }

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
        // 차종별 TrailFeatureLayer 생성 — typeGroups 없으면 단일 default 레이어
        const types = typeGroups && typeGroups.size > 0 ? [...typeGroups.keys()] : ['default'];
        types.forEach((vType) => {
            const tripLayer = new TrailFeatureLayer(vehicleRoute, speedFactor, isRunning, vType);
            const layers = this.vectorLayerManager.add(tripLayer, groupName, "trip", false);
            layers.forEach((layer: BaseLayer) => {
                if (!vectorLayers.includes(layer)) vectorLayers.push(layer);
            });
        });

        // 속도 히트맵 OL 2D (ImageLayer → any 캐스트)
        const speedOlLayer = new SpeedHeatmapOlLayer();
        const speedOlLayers = this.vectorLayerManager.add(speedOlLayer as any, groupName, "speed", false);
        speedOlLayers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) vectorLayers.push(layer);
        });
    }

    removeTripLayer(): void {
        this._removeLayers("analyze", "trip", "speed", "traffic", "default"); // trip + speed + traffic + default
    }

    addTrafficLayer() {
        const groupName = "analyze";
        const layerName = "traffic";
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        // OL 2D
        const trafficOl = new TrafficHeatmapFeatureLayer();
        const olLayers  = this.vectorLayerManager.add(trafficOl, groupName, layerName, false);
        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
        olLayers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) vectorLayers.push(layer);
        });

        // Cesium 3D (viewer 전달 → WallGeometry 빌드에 scene 필요)
        const trafficCesium = new TrafficHeatmapCesiumLayer(this.cesiumViewer);
        this.primitiveLayerManager.add(trafficCesium, groupName, layerName, false);
    }

    addVehicleLayer(
        vehicleRoute,
        vectorSource,
        speedFactor,
        isRunning,
        glbUrl: string = 'public/model_12.glb',
        correctionHpr?: Cesium.HeadingPitchRoll,
        vehicleType: string = 'default',
        zOffset: number = 0
    ) {
        const groupName = "analyze"
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;

        const VEHICLE_TYPE_COLORS: Record<string, [number, number, number]> = {
            'CAR':   [0.39, 0.63, 1.0],
            'TAXI':  [1.0,  0.86, 0.0],
            'BUS':   [1.0,  0.35, 0.35],
            'TRUCK': [0.71, 0.47, 0.24],
            'MOTO':  [0.31, 0.86, 0.51],
        };
        // 타입별 목표 차량 크기(m): GLB 모델이 이 크기로 자동 스케일됨
        const VEHICLE_TARGET_SIZE: Record<string, number> = {
            'CAR':   4,
            'TAXI':  4,
            'BUS':   10,
            'TRUCK': 8,
            'MOTO':  2,
        };
        const targetSizeM = VEHICLE_TARGET_SIZE[vehicleType] ?? 4;
        const primitive = new VehiclePrimitive(vehicleRoute, this.cesiumViewer, glbUrl, speedFactor, isRunning, correctionHpr, targetSizeM, zOffset);
        primitive.baseColor = VEHICLE_TYPE_COLORS[vehicleType] ?? [1, 1, 1];
        (primitive as any).vehicleType = vehicleType;
        this.primitiveLayerManager.add(primitive, groupName, "vehicle", true);
        // DomePrimitive(주황 점) → PointSpritePrimitive(통합, 용량 기반 재할당)
        // const primitiveCollections = this.primitiveLayerManager.add(
        //     new PointSpritePrimitive(this.cesiumViewer.scene.context, { color: [1.0, 0.5, 0.0], alpha: 0.5, pointSize: 10, zOffset: 5 }),
        //     groupName, "vehicle", true
        // )
        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);
        // if (!managedCollection.includes(primitiveCollections)) {
        //     managedCollection.push(primitiveCollections);
        // }

        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);
        // Each vehicle type gets its own VectorSource to prevent color/position conflicts
        const vehicleVectorSource = new VectorSource();
        const vehicleLayer = new VehicleFeatureLayer(vehicleRoute, vehicleVectorSource, speedFactor, isRunning, vehicleType);
        console.log(`[LayerManager] addVehicleLayer type=${vehicleType} color=${vehicleLayer.getStyle?.()}`);
        const layers = this.vectorLayerManager.add(vehicleLayer, groupName, "vehicle", true);

        const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);

        layers.forEach((layer: BaseLayer) => {
            if (!vectorLayers.includes(layer)) {
                vectorLayers.push(layer);
            }
        })

    }

    removeVehicleLayer(): void {
        this._removeLayers("analyze", "vehicle");
    }

    /** 실행 중인 VehiclePrimitive의 방향 보정값을 즉시 갱신합니다. */
    updateVehicleCorrection(vehicleType: string, hpr: Cesium.HeadingPitchRoll): void {
        this.primitiveLayerManager.getAllByGroup("analyze").forEach((p: any) => {
            if (p.vehicleType === vehicleType && typeof p.setCorrectionHpr === "function") {
                p.setCorrectionHpr(hpr);
            }
        });
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
    }

    async addFacilityLayers(schema: any[]) {
        const groupName = "facility";

        const facilityGroup = schema.find(group => group.key === groupName);
        if (!facilityGroup || !Array.isArray(facilityGroup.fields)) return;

        if (!this.layerGroups.has(groupName)) {
            this.layerGroups.set(groupName, facilityGroup);
        }

        // 모든 레이어 동적 import (eager로 정적 분석 시점에 가져옴)
        const cesiumModules = import.meta.glob("@datasource/*DataSourceLayer.ts", { eager: true });
        const olModules = import.meta.glob("@features/*FeatureLayer.ts", { eager: true });

        const classRegistry: Record<string, any> = {};

        // 클래스명으로 매핑
        Object.values(cesiumModules).forEach((mod: any) => {
            const cls = Object.values(mod)[0];
            classRegistry[cls.name] = cls;
        });

        Object.values(olModules).forEach((mod: any) => {
            const cls = Object.values(mod)[0];
            classRegistry[cls.name] = cls;
        });


        for (const { key, basic } of facilityGroup.fields) {
            const layerName = key;
            const pascalKey = toPascalCase(key);

            const CesiumLayerClass = classRegistry[`${ pascalKey }DataSourceLayer`];
            const OLFeatureLayerClass = classRegistry[`${ pascalKey }FeatureLayer`];


            const layerGroup = this.layerGroups.get(groupName) || {};
            if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

            if (OLFeatureLayerClass) {
                // OpenLayers 처리
                const olLayer = new OLFeatureLayerClass();
                const layers = this.vectorLayerManager.add(olLayer, groupName, layerName, basic);
                const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
                layers.forEach((layer: BaseLayer) => {
                    if (!vectorLayers.includes(layer)) {
                        vectorLayers.push(layer);
                    }
                });
                // 비동기 로딩 지원
                await olLayer.load?.();
            }

            if (CesiumLayerClass) {
                // Cesium 처리
                const cesiumLayer = new CesiumLayerClass(this.cesiumViewer);
                const dataSourceCollection = this.dataSourceLayerManager.add(cesiumLayer, groupName, layerName, basic);
                const managedCollection = (layerGroup["dataSourceLayerManager"] ||= []);
                if (!managedCollection.includes(dataSourceCollection)) {
                    managedCollection.push(dataSourceCollection);
                }
            }
        }
    }


    // === 레이어 그룹 관련 기능 ===

    // 특정 그룹의 모든 레이어 제거
    removeAllLayersFromGroup(groupName: string) {
        const group = this.layerGroups.get(groupName);
        if (group) {
            group.layers.forEach(({ layer }) => {
                this.primitiveLayerManager.remove("analyze", layer);
            });
            group.layers = [];
        } else {
            console.log(`Group "${ groupName }" does not exist.`);
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
                console.log(`Layer "${ layerName }" not found in group "${ groupName }".`);
            }
        } else {
            console.log(`Group "${ groupName }" does not exist.`);
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
            console.log(`Group "${ groupName }" does not exist.`);
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
            console.log(`Group "${ groupName }" does not exist.`);
        }
    }

    // 개별 레이어 보이기
    showLayer(groupName: string, layerName: string) {
        this.getManagersByGroupAndLayerName(groupName, layerName).forEach((manager) => {
            manager?.show(groupName, layerName);
        })
    }

    // 개별 레이어 숨기기
    hideLayer(groupName: string, layerName: string) {
        this.getManagersByGroupAndLayerName(groupName, layerName).forEach((manager) => {
            manager?.hide(groupName, layerName);
        })
    }

    toggleByFeatureType(groupName: string, layerName: string, featureType: string, visible: boolean) {
        this.getManagersByGroupAndLayerName(groupName, layerName).forEach((manager) => {
            manager?.toggleByFeatureType(groupName, layerName, featureType, visible);
        })
    }

    // groupName과 layerName으로 레이어 가져오기
    getLayer(groupName: string, layerName: string) {
        const manager = this.getManagersByGroupAndLayerName(groupName, layerName)
            .flatMap((manager) => { // 이중 배열 평탄화 [[HeatBarLayer],[Heatmap]] => [HeatBarLayer,Heatmap]
                const res = manager.get(groupName, layerName);
                return Array.isArray(res) ? res : res ? [ res ] : [];
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

function toPascalCase(key: string) {
    return key.replace(/(^\w|_\w)/g, s => s.replace('_', '').toUpperCase());
}

export default LayerManager;
