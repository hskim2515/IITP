import { Map as OLMap } from 'ol';
import Style from 'ol/style/Style';

import BaseLayer from 'ol/layer/Base';
import { isVectorLayer, isWebGLVectorLayer, matchesCustomKeyValue } from "@utils/olLayer";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorLayer from "ol/layer/Vector";
import HeatMapLayer from "@primitives/HeatMapLayer";

class VectorLayerManager {
    private id;
    private readonly olMap: OLMap;

    private layerStore;

    private layerGroups: {[key: string]: (VectorLayer | WebGLVectorLayer)[]} = {};

    constructor(olMap: OLMap, layerStore) {
        this.id = "vectorLayerManager";
        this.olMap = olMap;
        this.layerStore = layerStore;
    }

    getId() {
        return this.id;
    }

    public getOlMap(): OLMap {
        return this.olMap;
    }

    getLayerByName(layerName: string): VectorLayer | WebGLVectorLayer | null {
        for (const groupName in this.layerGroups) {
            const group = this.layerGroups[groupName];
            for (const layer of group) {
                if (matchesCustomKeyValue(layer, 'layer', layerName)) {
                    return layer;
                }
            }
        }
        return null;
    }

    _getOrCreateGroup(groupName: string) {
        if (!this.layerGroups[groupName]) {
            this.layerGroups[groupName] = [];
        }
        return this.layerGroups[groupName];
    }

    add(layer, groupName: string, layerName: string, basic: boolean) {
        const group = this._getOrCreateGroup(groupName);

        // 같은 layerName의 기존 레이어 모두 제거 (재초기화 시 중복 누적 방지)
        const existingByName = group.filter(l => matchesCustomKeyValue(l, 'layer', layerName));
        existingByName.forEach(l => {
            const source = (l as any).getSource?.();
            if (source && typeof source.clear === 'function') source.clear();
            if ((l as any).unsubscribe) (l as any).unsubscribe();
            this.olMap.removeLayer(l);
            const idx = group.indexOf(l);
            if (idx > -1) group.splice(idx, 1);
        });

        const isOnMap = this.olMap.getLayers().getArray().includes(layer);

        layer["layerGroup"] = groupName;
        layer["layer"] = layerName;

        layer.values_.visible = basic;

        group.push(layer);
        if (!isOnMap) {
            this.olMap.addLayer(layer);
        }

        return group;
    }


    /** exact match OR prefix match (layerName + '_') */
    private _matchName(layer: BaseLayer, layerName: string): boolean {
        const stored = (layer as any)['layer'] as string | undefined;
        if (!stored) return false;
        return stored === layerName || stored.startsWith(layerName + '_');
    }

    public get(groupName: string, layerName: string) {
        const group = this.layerGroups[groupName];
        if (!group) return [];
        return group.filter(layer => this._matchName(layer, layerName));
    }

    public getAllByGroup(groupName: string) {
        const group = this.layerGroups[groupName];
        if (!group) return [];

        const result = [];
        for (let i = 0; i < group.length; i++) {
            result.push(group[i]);
        }
        return result;
    }

    show(groupName: string, layerName: string): void {
        const group = this.layerGroups[groupName];
        if (!group) return;
        group.forEach(layer => {
            if (this._matchName(layer, layerName)) layer.setVisible(true);
        });
    }

    hide(groupName: string, layerName: string) {
        const group = this.layerGroups[groupName];
        if (!group) return;
        group.forEach(layer => {
            if (this._matchName(layer, layerName)) layer.setVisible(false);
        });
    }

    toggle(groupName: string, layerName: string) {
        const items = this.get(groupName, layerName);
        if (items.length === 0) return;
        const shouldShow = !items[0].getVisible();
        items.forEach(l => l.setVisible(shouldShow));
    }

    toggleByFeatureType(groupName: string, layerName: string, featureType: string, visible: boolean) {
        const group = this.layerGroups[groupName];
        if (!group) return;

        // exact match 만 보면 prefix 로 등록된 하위 레이어(layerName_*)가 누락된다 — _matchName 사용
        group.forEach(layer => {
            if (!this._matchName(layer, layerName)) return;

            // 레이어가 자체 구현을 제공하면 위임한다. MVT(VectorTile)로 그리는 도로/차선은
            // per-feature setStyle 이 불가하므로 레이어 내부에서 style 게이트로 처리해야
            // 실제로 2D 에서 사라진다 (기존 피처 스타일 토글만으로는 계속 보였던 원인).
            const custom = (layer as any).toggleFeatureTypeVisible;
            if (typeof custom === 'function') {
                custom.call(layer, featureType, visible);
                return;
            }

            if (isVectorLayer(layer) || isWebGLVectorLayer(layer)) {
                const source = layer.getSource();
                if (!source) return;
                // featureType 별로 필터링
                const features = source.getFeatures().filter(f => f.get('featureType') === featureType);
                features.forEach(feature => {
                    if (visible) {
                        feature.setStyle(null);
                    } else {
                        feature.setStyle(new Style({}));
                    }
                });
                try { (layer as any).changed?.(); } catch (_) { /* noop */ }
            }
        });
        try { this.olMap.render(); } catch (_) { /* noop */ }
    }


    remove(groupName: string, layerName: string) {
        const group: BaseLayer[] = this.layerGroups[groupName];
        if (!group) return;

        const layersToRemove = group.filter(layer => this._matchName(layer, layerName));
        layersToRemove.forEach(layer => {
            // 소스를 가진 모든 레이어 타입 (VectorLayer, WebGLVectorLayer, Heatmap 등) 소스 클리어
            const source = (layer as any).getSource?.();
            if (source && typeof source.clear === 'function') {
                source.clear();
            }
            this.olMap.removeLayer(layer);
            const index = group.indexOf(layer);
            if (index > -1) {
                group.splice(index, 1);
            }
        });
    }

}

export default VectorLayerManager;