import * as Cesium from "cesium";

class PrimitiveLayerManager {
    private id;
    private viewer;
    private layerGroups;
    private onAdd;
    private onRemove;
    private layerStore;

    constructor(viewer, layerStore) {
        this.id = "primitiveLayerManager";
        this.viewer = viewer;
        this.layerGroups = {}; // { groupName: PrimitiveCollection }
        this.onAdd = null;
        this.onRemove = null;
        this.layerStore = layerStore;
    }
    getId() {
        return this.id;
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
    add(primitive, groupName, layerName, basic) {
        primitive.layerGroup = groupName;
        primitive.layer = layerName;
        const group = this._getOrCreateGroup(groupName);
        primitive.show = basic;
        group.add(primitive);
        this.layerStore.getState().activeLayerName?.forEach((activeLayerName) => {
            if(activeLayerName === layerName){
                this.show('analyze', activeLayerName);
            }
        });

        if (typeof this.onAdd === 'function') {
            this.onAdd(primitive, groupName, layerName);
        }

        return group;
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
        return result ?? null;
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
            const p = group.get(i);
            result.push(p);
        }
        return result ?? null;
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