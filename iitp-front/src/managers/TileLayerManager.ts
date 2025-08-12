import { Map as OLMap } from "ol";

import BaseLayer from "ol/layer/Base";
import { Tile as TileLayer } from "ol/layer";
import { XYZ } from "ol/source";
import { hasCustomKeys, matchesCustomKeyValue } from "@utils/olLayer";
class TileLayerManager {
    private id;
    private olMap;
    private baseLayerGroups: { [groupName: string]: BaseLayer[] } = {};

    constructor(map: OLMap) {
        this.id = "tileLayerManager";
        this.olMap = map;
    }
    getId() {
        return this.id;
    }
    private _getOrCreateGroup(groupName: string): BaseLayer[] {
        if (!this.baseLayerGroups[groupName]) {
            this.baseLayerGroups[groupName] = [];
        }
        return this.baseLayerGroups[groupName];
    }

    public createBaseLayer(schema: any[]) {
        const baseMapGroup = schema.find(group => group.key === "baseMap");
        if (!baseMapGroup || !Array.isArray(baseMapGroup.fields)) return;
        const group = this._getOrCreateGroup("baseMap");

        baseMapGroup.fields.forEach(field => {
            const { key, url, basic } = field;
            if (!url || !key) return;

            const apiKey = process.env.REACT_APP_VWORLD_API_KEY;

            let finalUrl = url;
            if (url.includes("${API_KEY}")) {
                finalUrl = url.replace("${API_KEY}", apiKey ?? "");
            }

            const layer = new TileLayer({
                visible: basic,
                zIndex: 1,
                source: new XYZ({
                    url: finalUrl
                })
            })
            this.olMap.addLayer(layer);

            layer["layerGroup"] = "baseMap";
            layer["layer"] = key;

            group.push(layer);
        });
        return group;
    }

    public show(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        const visibleLayers = layerName === "hybrid" ? ["hybrid", "satellite"] : [layerName];

        group.forEach(layer => {
            const name = layer["layer"];
            layer.setVisible(visibleLayers.includes(name));
        });
    }

    public hide(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        group.forEach(layer => {
            if(matchesCustomKeyValue(layer, 'layer', layerName)) layer.setVisible(false)
        });
    }

    public toggle(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        const target = group.find(layer => matchesCustomKeyValue(layer, 'baseMap', layerName));
        if (target) {
            const newState = !target.getVisible();
            group.forEach(layer => {
                if (matchesCustomKeyValue(layer, 'baseMap', layerName)) {
                    layer.setVisible(newState);
                }
            });
        }
    }

    public get(groupName:string, layerName:string) {
        const group = this.baseLayerGroups[groupName];
        if (!group) return null;
        return group.find(layer => matchesCustomKeyValue(layer, 'layer', layerName)) ?? null;
    }

    public getAllByGroup(groupName:string) {
        const group = this.baseLayerGroups[groupName];
        console.log("baseLayerGroups tile groupName:::", group)
        if (!group) return [];

        const result = [];
        for (let i = 0; i < group.length; i++) {
            result.push(group[i]);
        }
        return result;
    }

    public setOpacity(groupName: string, layerName: string, alpha: number): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        group.forEach(layer => {
            if (matchesCustomKeyValue(layer, 'layer', layerName) && layer.getOpacity() !== undefined) {
                layer.setVisible(alpha);
            }
        });
    }

    public remove(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        console.log("this.layerGroups.vectorLayer.remove baseLayerGroups, only source:::", groupName, layerName, group)
        if (!group) return;

        for (let i = group.length - 1; i >= 0; i--) {
            const layer = group[i];
            if (matchesCustomKeyValue(layer, 'layer', layerName)) {
                this.olMap.removeLayer(layer);
                group.splice(i, 1);
            }
        }
    }

    public removeGroup(groupName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        group.forEach(layer => {
            this.olMap.removeLayer(layer);
        });

        delete this.baseLayerGroups[groupName];
    }
}

export default TileLayerManager;
