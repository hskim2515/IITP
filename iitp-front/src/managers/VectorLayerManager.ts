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

        // Deduplicate by instance identity only (not by layerName)
        // This allows multiple layers with the same layerName (e.g., vehicle_CAR, vehicle_TAXI etc.)
        const existingIndex = group.indexOf(layer);
        if (existingIndex > -1) group.splice(existingIndex, 1);

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


    public get(groupName: string, layerName: string) {
        const group = this.layerGroups[groupName];
        if (!group) return [];
        return group.filter(layer => matchesCustomKeyValue(layer, 'layer', layerName));
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
            if (matchesCustomKeyValue(layer, 'layer', layerName)) {
                console.log(" show layerName", layerName)
                layer.setVisible(true);
            }
        });
    }

    hide(groupName: string, layerName: string) {
        this.get(groupName, layerName).forEach(layer => layer.setVisible(false));
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

        group.forEach(layer => {
            if (matchesCustomKeyValue(layer, 'layer', layerName)
                && (isVectorLayer(layer) || isWebGLVectorLayer(layer))) {
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
            }
        });
    }


    remove(groupName: string, layerName: string) {
        const group: BaseLayer[] = this.layerGroups[groupName];
        if (!group) return;

        const layersToRemove = group.filter(layer => matchesCustomKeyValue(layer, 'layer', layerName));
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