import { Map as OLMap } from 'ol';
import BaseLayer from 'ol/layer/Base';

class VectorLayerManager {
    private id;
    private olMap: OLMap;
    private onAdd;
    private onRemove;

    private layerStore;

    private layerGroups: { [key: string]: BaseLayer[] } = {};

    constructor(olMap: OLMap, layerStore) {
        this.id = "vectorLayerManager";
        this.olMap = olMap;
        this.onAdd = null;
        this.onRemove = null;
        this.layerStore = layerStore;
    }

    getId() {
        return this.id;
    }

    public getOlMap(): OLMap {
        return this.olMap;
    }

    getLayerByName(layerName: string): BaseLayer | null {
        for (const groupName in this.layerGroups) {
            const group = this.layerGroups[groupName];
            for (const layer of group) {
                if (layer["layer"] === layerName || layer.get("name") === layerName) {
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

    add(layer, groupName, layerName) {
        const group = this._getOrCreateGroup(groupName);

        const existingLayer = group.find(layer => layer["layer"] === layerName);
        const isOnMap = this.olMap.getLayers().getArray().includes(layer);

        layer["layerGroup"] = groupName;
        layer["layer"] = layerName;


            if (existingLayer) {
                const index = group.indexOf(existingLayer);
                if (index > -1) group.splice(index, 1);
            }

            group.push(layer);
            if (!isOnMap) {
                this.olMap.addLayer(layer);
            }

            if (typeof this.onAdd === 'function') {
                this.onAdd(layer, groupName, layerName);
            }
        return group;
    }


    public get(groupName: string, layerName: string) {
        const group = this.layerGroups[groupName];
        if (!group) return [];
        return group.filter(layer => layer["layer"] === layerName);
    }

    public getAllByGroup(groupName) {
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
            if (layer["layer"] === layerName) {
                console.log(" show layerName", layerName)
                layer.setVisible(true);
            }
        });
    }

    hide(groupName, layerName) {
        this.get(groupName, layerName).forEach(layer => layer.setVisible(false));
    }

    toggle(groupName, layerName) {
        const items = this.get(groupName, layerName);
        if (items.length === 0) return;
        const shouldShow = !items[0].getVisible();
        items.forEach(l => l.setVisible(shouldShow));
    }


    remove(groupName, layerName) {
        const group: BaseLayer[] = this.layerGroups[groupName];
        if (!group) return;

        const layersToRemove = group.filter(layer => layer["layer"] === layerName);
        layersToRemove.forEach(layer => {
            if (typeof layer.getSource === 'function') {
                const source = layer.getSource();
                if (source && typeof source.clear === 'function') {
                    source.clear();
                }
            }
            this.olMap.removeLayer(layer);
            const index = group.indexOf(layer);
            if (index > -1) {
                group.splice(index, 1);
            }
        });
    }

    // 이벤트 훅 설정
    setOnAddCallback(callback) {
        this.onAdd = callback;
    }

    setOnRemoveCallback(callback) {
        this.onRemove = callback;
    }
}

export default VectorLayerManager;