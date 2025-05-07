import * as Cesium from "cesium";
import { ConstructorOptions } from "cesium";

class PrimitiveLayerManager {

    private viewer;
    private baseLayerGroups;
    private layerGroups;
    private onAdd;
    private onRemove;
    private layerStore;

    constructor(viewer, layerStore) {
        this.viewer = viewer;
        this.baseLayerGroups = {}; // { groupName: ImageryLayerCollection }
        this.layerGroups = {}; // { groupName: PrimitiveCollection }
        this.onAdd = null;
        this.onRemove = null;
        this.layerStore = layerStore;
    }


    _getOrCreateBaseGroup(groupName) {
        if (!this.baseLayerGroups[groupName]) {
            const group = new Cesium.ImageryLayerCollection();
            this.viewer.imageryLayers.add(group);
            this.baseLayerGroups[groupName] = group;
        }
        return this.baseLayerGroups[groupName];
    }
    createBaseLayer(schema: any[]) {
        const baseMapGroup = schema.find(group => group.key === "baseMap");
        if (!baseMapGroup || !Array.isArray(baseMapGroup.fields)) return;

        baseMapGroup.fields.forEach(field => {
            const { key, url, basic } = field;
            if (!url || !key) return;
            const provider = this.createCesiumLayer(url, basic);
            const imageryLayer = new Cesium.ImageryLayer(provider, { show: basic });

            // viewer에 추가
            this.viewer.imageryLayers.add(imageryLayer);

            // PrimitiveLayerManager 내부 그룹에도 등록
            this._addImageryLayer(imageryLayer, "baseMap", key);

        });
        const group = this._getOrCreateBaseGroup("baseMap");
        console.log("group:::", group)
    }
    // imageryLayer를 기존 primitive처럼 등록
    _addImageryLayer(
        layer: Cesium.ImageryLayer,
        groupName: string,
        layerName: string
    ) {
        layer.layerGroup = groupName;
        layer.layer = layerName;

        if (!this.baseLayerGroups[groupName]) {
            this.baseLayerGroups[groupName] = [];
        }
        this.baseLayerGroups[groupName].push(layer);
    }

    createCesiumLayer (url, show) {
        return new Cesium.UrlTemplateImageryProvider({ url: url});
    };

    removeAllCesiumLayers(){
        const imageryLayers = this.viewer.imageryLayers;

        while (imageryLayers.length > 1) {
            imageryLayers.remove(imageryLayers.get(1));
        }
    };

    public showBaseLayer(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        const visibleLayerNames = layerName === "hybrid"
            ? ["hybrid", "satellite"]
            : [layerName];

        group.forEach((layer: Cesium.ImageryLayer) => {
            const customName = (layer as any).layer;
            layer.show = visibleLayerNames.includes(customName);
        });
    }


    // 내부 그룹 관리
    _getOrCreateGroup(groupName) {
        if (!this.layerGroups[groupName]) {
            const group = new Cesium.PrimitiveCollection();
            this.viewer.scene.primitives.add(group);
            this.layerGroups[groupName] = group;
        }
        return this.layerGroups[groupName];
    }

    // Primitive 추가
    add(primitive, groupName, layerName) {
        primitive.layerGroup = groupName;
        primitive.layer = layerName;
        const group = this._getOrCreateGroup(groupName);
        group.add(primitive);
        this.layerStore.getState().activeLayerName?.forEach((activeLayerName) => {
            if(activeLayerName === layerName){
                this.show('layer', activeLayerName);
            }
        });


        if (typeof this.onAdd === 'function') {
            this.onAdd(primitive, groupName, layerName);
        }
    }

    // Primitive 조회
    get(groupName, layerName) {
        const group = this.layerGroups[groupName];
        if (!group) return [];
        const result = [];
        for (let i = 0; i < group.length; i++) {
            const p = group.get(i);
            if (p.layer === layerName) result.push(p);
        }
        return result;
    }

    // 레이어 보기/숨기기
    show(groupName, layerName) {
        this.get(groupName, layerName).forEach(p => p.show = true);
    }

    hide(groupName, layerName) {
        this.get(groupName, layerName).forEach(p => p.show = false);
    }

    hideAll(groupName) {
        this.getAllByGroup(groupName).forEach(p => p.show = false);
    }

    toggle(groupName, layerName) {
        const items = this.get(groupName, layerName);
        if (items.length === 0) return;
        const shouldShow = !items[0].show;
        items.forEach(p => p.show = shouldShow);
    }

    // 투명도 조절 (appearance가 존재하고 material 지원 시)
    setOpacity(groupName, layerName, alpha) {
        this.get(groupName, layerName).forEach(p => {
            if (p.appearance && p.appearance.material && p.appearance.material.uniforms && 'color' in p.appearance.material.uniforms) {
                let color = p.appearance.material.uniforms.color;
                p.appearance.material.uniforms.color = new Cesium.Color(color.red, color.green, color.blue, alpha);
            }
        });
    }

    // 레이어 제거
    remove(groupName, layerName) {
        const group = this.layerGroups[groupName];
        if (!group) return;
        for (let i = group.length - 1; i >= 0; i--) {
            const p = group.get(i);
            if (p.layer === layerName) {
                group.remove(p);
                if (typeof this.onRemove === 'function') {
                    this.onRemove(p, groupName, layerName);
                }
            }
        }
    }

    // 그룹 전체 제거
    removeGroup(groupName) {
        const group = this.layerGroups[groupName];
        if (group) {
            this.viewer.scene.primitives.remove(group);
            delete this.layerGroups[groupName];
        }
    }

    // 그룹 내 레이어 이름들 조회
    getAllLayerNames(groupName) {
        const group = this.layerGroups[groupName];
        if (!group) return [];
        const layerNames = new Set();
        for (let i = 0; i < group.length; i++) {
            const p = group.get(i);
            if (p.layer) {
                layerNames.add(p.layer);
            }
        }
        return Array.from(layerNames);
    }

    // 모든 그룹 이름 조회
    getAllGroups() {
        return Object.keys(this.layerGroups);
    }

    // 그룹 내 모든 primitive 반환
    getAllByGroup(groupName) {
        const group = this.layerGroups[groupName];
        if (!group) return [];

        const result = [];
        for (let i = 0; i < group.length; i++) {
            result.push(group.get(i));
        }
        return result;
    }

    // 그룹 내 primitive들을 레이어별로 묶어서 반환
    getAllByGroupGrouped(groupName) {
        const group = this.layerGroups[groupName];
        if (!group) return {};

        const grouped = {};
        for (let i = 0; i < group.length; i++) {
            const p = group.get(i);
            const name = p.layer || "unnamed";
            if (!grouped[name]) grouped[name] = [];
            grouped[name].push(p);
        }
        return grouped;
    }

    // 이벤트 훅 설정
    setOnAddCallback(callback) {
        this.onAdd = callback;
    }

    setOnRemoveCallback(callback) {
        this.onRemove = callback;
    }
}


export default PrimitiveLayerManager;