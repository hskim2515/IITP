import * as Cesium from "cesium";

class BaseMapLayerManager {
    private viewer;
    private baseLayerGroups: { [groupName: string]: Cesium.ImageryLayer[] } = {};

    constructor(viewer: Cesium.Viewer) {
        this.viewer = viewer;
    }

    private _getOrCreateGroup(groupName: string): Cesium.ImageryLayer[] {
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

            const provider = new Cesium.UrlTemplateImageryProvider({ url });
            const imageryLayer = new Cesium.ImageryLayer(provider, { show: basic });

            this.viewer.imageryLayers.add(imageryLayer);

            imageryLayer["layerGroup"] = "baseMap";
            imageryLayer["layer"] = key;

            group.push(imageryLayer);
        });
        return group;
    }

    public show(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        const visibleLayers = layerName === "hybrid" ? ["hybrid", "satellite"] : [layerName];

        group.forEach(layer => {
            const name = layer["layer"];
            layer.show = visibleLayers.includes(name);
        });
    }

    public hide(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        group.forEach(layer => {
            const name = layer["layer"];
            if (name === layerName) {
                layer.show = false;
            }
        });
    }

    public toggle(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        const target = group.find(layer => layer["layer"] === layerName);
        if (target) {
            const newState = !target.show;
            group.forEach(layer => {
                if (layer["layer"] === layerName) {
                    layer.show = newState;
                }
            });
        }
    }

    public get(groupName, layerName) {
        const group = this.baseLayerGroups[groupName];
        if (!group) return null;
        return group.find(layer => layer["layer"] === layerName) ?? null;
    }

    public setOpacity(groupName: string, layerName: string, alpha: number): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        group.forEach(layer => {
            if (layer["layer"] === layerName && layer.alpha !== undefined) {
                layer.alpha = alpha;
            }
        });
    }

    public removeBaseLayer(groupName: string, layerName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        for (let i = group.length - 1; i >= 0; i--) {
            const layer = group[i];
            if (layer["layer"] === layerName) {
                this.viewer.imageryLayers.remove(layer, true);
                group.splice(i, 1);
            }
        }
    }

    public removeGroup(groupName: string): void {
        const group = this.baseLayerGroups[groupName];
        if (!group) return;

        group.forEach(layer => {
            this.viewer.imageryLayers.remove(layer, true);
        });

        delete this.baseLayerGroups[groupName];
    }
}

export default BaseMapLayerManager;
