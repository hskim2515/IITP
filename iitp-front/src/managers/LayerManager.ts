import HeatBarLayer from "@primitives/HeatBarLayer";
import ParabolicArrowPrimitive from "@primitives/ParabolicArrowPrimitive";
import TailPrimitive from "@primitives/TailPrimitive";
import VehiclePrimitive from "@primitives/VehiclePrimitive";
import SpeedHeatmapLayer from "@primitives/SpeedHeatmapLayer";
import OdFlowCesiumLayer from "@primitives/OdFlowCesiumLayer";
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
    // 차종(vehicleType) → 현재 사용 중인 VehiclePrimitive. 뷰포트 재로드마다 destroy+재생성하지
    // 않고 같은 GLB를 쓰는 기존 인스턴스를 재사용(updateInstances)하기 위한 추적 — addVehicleLayer/
    // pruneVehicleTypes/removeVehicleLayer 참고.
    private vehiclePrimitivesByType: Map<string, VehiclePrimitive> = new Map();

    constructor(
        private primitiveLayerManager: PrimitiveLayerManager,
        private baseMapLayerManager: BaseMapLayerManager,
        private cesiumViewer: Cesium.Viewer,
        private vectorLayerManager: VectorLayerManager | null,
        private dataSourceLayerManager: DataSourceLayerManager,
        private tileLayerManager: TileLayerManager | null,
        private olMap: OLMap | null,
        private simulationStore: any
    ) {
        this.managers = [primitiveLayerManager, baseMapLayerManager, vectorLayerManager, tileLayerManager, dataSourceLayerManager]
            .filter(Boolean) as Manager[];
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
        if (this.vectorLayerManager) {
            const olHeatmap = new HeatmapFeatureLayer(vehicleRoute, vectorSource, speedFactor, isRunning, colors, blur);
            const layers = this.vectorLayerManager.add(olHeatmap, groupName, layerName, olHeatmap.getVisible());
            const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
            layers.forEach((layer: BaseLayer) => { if (!vectorLayers.includes(layer)) vectorLayers.push(layer); });
        }
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

        if (this.vectorLayerManager) {
            const odLayer = new ODMatrixFeatureLayer(vehicleRoute, speedFactor, isRunning);
            const layers = this.vectorLayerManager.add(odLayer, groupName, layerName, odLayer.getVisible());
            const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
            layers.forEach((layer: BaseLayer) => { if (!vectorLayers.includes(layer)) vectorLayers.push(layer); });
        }
    }

    removeODArrows(): void {
        this._removeLayers("analyze", "od");
    }

    addTripLayer(vehicleRoute: any[], speedFactor: number, isRunning: boolean, typeGroups?: Map<string, any[]>, vehicleTypeArray?: string[], typeColorMap: Record<string, string> = {}) {
        const groupName = "analyze"
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        const tailPaths = vehicleRoute.map((entry: any) => Array.isArray(entry) ? entry : entry.path);
        this.primitiveLayerManager.add(new TailPrimitive(tailPaths, this.cesiumViewer.scene.context, speedFactor, isRunning, vehicleTypeArray ?? [], typeColorMap), groupName, "trip");
        // 속도 히트맵 레이어: Cesium 3D
        const primitiveCollections = this.primitiveLayerManager.add(new SpeedHeatmapLayer(this.cesiumViewer), groupName, "speed");
        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);
        if (!managedCollection.includes(primitiveCollections)) {
            managedCollection.push(primitiveCollections);
        }

        if (this.vectorLayerManager) {
            const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
            const types = typeGroups && typeGroups.size > 0 ? [...typeGroups.keys()] : ['default'];
            types.forEach((vType) => {
                const tripLayer = new TrailFeatureLayer(vehicleRoute, speedFactor, isRunning, vType, typeColorMap[vType]);
                const layers = this.vectorLayerManager!.add(tripLayer, groupName, `trip_${vType}`, false);
                layers.forEach((layer: BaseLayer) => { if (!vectorLayers.includes(layer)) vectorLayers.push(layer); });
            });
            const speedOlLayer = new SpeedHeatmapOlLayer();
            const speedOlLayers = this.vectorLayerManager.add(speedOlLayer as any, groupName, "speed", false);
            speedOlLayers.forEach((layer: BaseLayer) => { if (!vectorLayers.includes(layer)) vectorLayers.push(layer); });
        }
    }

    removeTripLayer(): void {
        // trip + speed + odFlow + default
        this._removeLayers("analyze", "trip", "speed", "odFlow", "default");
    }

    /**
     * OD 흐름 레이어 — 히트맵보다도 더 축소된 가장 바깥 줌 티어. OdFlowCesiumLayer가 자체적으로
     * 줌을 추적해 OD_FLOW 임계값 이상에서만 활성화되므로 addHeatmapLayer/addTripLayer와 동일하게
     * 매 refresh마다 생성만 하면 된다. 기존 "od"(개별 차량 기반 ParabolicArrowPrimitive, addODArrows)
     * 레이어와는 별개 — 데이터 소스가 백엔드 집계라 이름도 "odFlow"로 분리.
     */
    addOdFlowLayer() {
        const groupName = "analyze";
        const layerName = "odFlow";
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;
        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

        const odFlowCesium = new OdFlowCesiumLayer(this.cesiumViewer);
        this.primitiveLayerManager.add(odFlowCesium, groupName, layerName, false);
    }

    addVehicleLayer(
        vehicleRoute,
        vectorSource,
        speedFactor,
        isRunning,
        glbUrl: string = 'public/model_12.glb',
        correctionHpr?: Cesium.HeadingPitchRoll,
        vehicleType: string = 'default',
        zOffset: number = 0,
        scales?: number[],
        modelColor?: string
    ) {
        const groupName = "analyze"
        const layerGroup: Record<string, any[]> = (this.layerGroups.get(groupName) || {}) as any;

        // 타입별 목표 차량 크기(m): GLB 모델이 이 크기로 자동 스케일됨
        const VEHICLE_TARGET_SIZE: Record<string, number> = {
            'CAR':   4,
            'TAXI':  4,
            'BUS':   10,
            'TRUCK': 8,
            'MOTO':  2,
        };

        const parseHexColor = (hex: string): [number, number, number] | null => {
            const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
            if (!m || !m[1] || !m[2] || !m[3]) return null;
            return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
        };

        const resolvedColor: [number, number, number] =
            (modelColor ? parseHexColor(modelColor) : null)
            ?? [0.98, 0.74, 0.38];

        const targetSizeM = VEHICLE_TARGET_SIZE[vehicleType] ?? 4;

        // 같은 차종(같은 glbUrl)의 기존 VehiclePrimitive가 있으면 destroy+재생성 대신 인스턴스
        // 데이터만 갱신한다 — GLB가 이미 로드/GPU 업로드된 상태이므로 화면 공백 없이 즉시 반영된다.
        // (뷰포트 팬/줌·재생 시간창 롤오버마다 전체 재생성하던 것이 "차량이 나타났다 사라졌다"의 원인이었음)
        const existing = this.vehiclePrimitivesByType.get(vehicleType);
        let primitive: VehiclePrimitive;
        if (existing && !existing.destroyed && existing.glbUrl === glbUrl) {
            existing.updateInstances(vehicleRoute, scales);
            existing.baseColor = resolvedColor;
            existing.zOffset = zOffset;
            existing.setSpeed(speedFactor);
            existing.setStatus(isRunning);
            if (correctionHpr) existing.setCorrectionHpr(correctionHpr);
            primitive = existing;
        } else {
            if (existing) this.primitiveLayerManager.removeInstance(groupName, existing);
            primitive = new VehiclePrimitive(vehicleRoute, this.cesiumViewer, glbUrl, speedFactor, isRunning, correctionHpr, targetSizeM, zOffset, scales);
            primitive.baseColor = resolvedColor;
            primitive.vehicleType = vehicleType;
            this.primitiveLayerManager.add(primitive, groupName, "vehicle", true);
            this.vehiclePrimitivesByType.set(vehicleType, primitive);
        }
        const managedCollection = (layerGroup["primitiveLayerManager"] ||= []);

        if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);
        // Each vehicle type gets its own VectorSource to prevent color/position conflicts
        // (OL feature layer는 GLB 같은 비동기 에셋 로딩이 없어 매번 재생성해도 화면 공백이 없음)
        if (this.vectorLayerManager) {
            this._removeLayers(groupName, `vehicle_${vehicleType}`);
            const vehicleVectorSource = new VectorSource();
            const vehicleLayer = new VehicleFeatureLayer(vehicleRoute, vehicleVectorSource, speedFactor, isRunning, vehicleType, modelColor);
            const olLayerName = `vehicle_${vehicleType}`;
            const layers = this.vectorLayerManager.add(vehicleLayer, groupName, olLayerName, true);
            const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
            layers.forEach((layer: BaseLayer) => { if (!vectorLayers.includes(layer)) vectorLayers.push(layer); });
        }

    }

    /**
     * 이번 refresh에서 더 이상 나타나지 않는 차종의 VehiclePrimitive를 정리한다.
     * addVehicleLayer()는 현재 데이터에 존재하는 차종만 호출되므로, 이전엔 있었지만 이번엔 없는
     * 차종(예: 이전 viewport엔 BUS가 있었는데 새 viewport엔 없음)은 destroy+재생성 대상에서
     * 빠져 갱신되지 않은 채 남는다 — setSimulation()에서 addVehicleLayer 호출들 뒤에 반드시 호출할 것.
     */
    pruneVehicleTypes(activeTypes: string[]): void {
        const activeSet = new Set(activeTypes);
        for (const [type, primitive] of Array.from(this.vehiclePrimitivesByType.entries())) {
            if (activeSet.has(type)) continue;
            this.primitiveLayerManager.removeInstance("analyze", primitive);
            this.vehiclePrimitivesByType.delete(type);
            this._removeLayers("analyze", `vehicle_${type}`);
        }
    }

    removeVehicleLayer(): void {
        // 차종별 OL 레이어 (vehicle_CAR, vehicle_TAXI 등) + Cesium primitive 모두 제거
        const vehicleTypes = ['default', 'CAR', 'TAXI', 'BUS', 'TRUCK', 'MOTO'];
        vehicleTypes.forEach(t => this._removeLayers("analyze", `vehicle_${t}`));
        this._removeLayers("analyze", "vehicle");
        this.vehiclePrimitivesByType.clear();
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
            if (cls && cls.name) classRegistry[cls.name] = cls;
        });

        Object.values(olModules).forEach((mod: any) => {
            const cls = Object.values(mod)[0];
            if (cls && cls.name) classRegistry[cls.name] = cls;
        });


        for (const { key, basic } of facilityGroup.fields) {
            try {
                const layerName = key;
                const pascalKey = toPascalCase(key);

                const CesiumLayerClass = classRegistry[`${ pascalKey }DataSourceLayer`];
                const OLFeatureLayerClass = classRegistry[`${ pascalKey }FeatureLayer`];


                const layerGroup = this.layerGroups.get(groupName) || {};
                if (!this.layerGroups.has(groupName)) this.layerGroups.set(groupName, layerGroup);

                if (OLFeatureLayerClass && this.vectorLayerManager) {
                    const olLayer = new OLFeatureLayerClass();
                    const layers = this.vectorLayerManager.add(olLayer, groupName, layerName, basic);
                    const vectorLayers: BaseLayer[] = (layerGroup["vectorLayerManager"] ||= []);
                    layers.forEach((layer: BaseLayer) => {
                        if (!vectorLayers.includes(layer)) vectorLayers.push(layer);
                    });
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
            } catch (err) {
                console.error(`[addFacilityLayers] 레이어 "${key}" 초기화 실패:`, err);
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
        return [
            ...this.primitiveLayerManager.getAllByGroup(groupName),
            ...this.baseMapLayerManager.getAllByGroup(groupName),
            ...(this.vectorLayerManager?.getAllByGroup(groupName) ?? []),
        ];
    }

    getLayerGroup(groupName: string) {
        return this.getAllLayersByGroup(groupName);
    }

    getLayerByName(layerName: string) {
        return this.vectorLayerManager?.getLayerByName(layerName) ?? null;
    }

    /** Cesium 레이어 래퍼 인스턴스(XxxDataSourceLayer) 조회 — public 메서드 호출용 */
    getDataSourceLayerByName(layerName: string) {
        return this.dataSourceLayerManager?.getInstanceByName(layerName) ?? null;
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
        this.removeVehicleLayer();
        // OL 맵 강제 재렌더링 - WebGL 레이어 제거 후 화면 즉시 갱신
        this.olMap?.render();
    }

    /**
     * removeSimulationLayers()와 동일하되 차량(Cesium VehiclePrimitive)은 건드리지 않는다.
     * 뷰포트 스트리밍의 매 데이터 refresh(setSimulation)에서 사용 — 차량은 addVehicleLayer()가
     * 같은 차종이면 updateInstances()로 갱신하고, 더 이상 없는 차종은 pruneVehicleTypes()가
     * 정리한다. 시나리오 전환 등 완전 초기화가 필요한 경우엔 removeSimulationLayers()를 쓸 것.
     *
     * ⚠️ heatmap은 여기서 더 이상 제거하지 않는다 — grid 기반이라 차량 수/타입이 바뀌어도 재생성할
     * 이유가 없는데(trip의 TailPrimitive와 달리 per-vehicle 슬롯이 없음), 매 refresh(뷰포트
     * 스트리밍은 몇 초~수십 초 간격으로 잦음)마다 destroy+재생성하면 그 사이 잠깐 사라졌다 다시
     * 생기는 게 반복돼 깜빡임으로 보였다. 게다가 이 remove(비동기 setSimulation 콜백 안)와
     * useSimulation.ts의 vehicleRoute===0 분기(동기, 즉시 실행)의 존재 확인 가드가 타이밍에 따라
     * 서로 어긋나면 heatmap 인스턴스가 2개 동시에 살아남는 경우까지 있었다(각각 다른 상태로
     * decay/정규화를 계산해 서로 다른 밝기로 겹쳐 그려지며 깜빡이는 것처럼 보임). heatmap은
     * addHeatmapLayer() 쪽에서 "없을 때만 생성"으로 관리한다.
     */
    removeSimulationLayersExceptVehicle() {
        this.removeTripLayer();
        this.removeODArrows();
        this.olMap?.render();
    }


}

function toPascalCase(key: string) {
    return key.replace(/(^\w|_\w)/g, s => s.replace('_', '').toUpperCase());
}

export default LayerManager;
