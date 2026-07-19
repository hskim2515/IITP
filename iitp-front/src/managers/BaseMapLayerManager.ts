import * as Cesium from "cesium";

class BaseMapLayerManager {
    private id;
    private viewer;
    private baseLayerGroups: { [groupName: string]: Cesium.ImageryLayer[] } = {};

    constructor(viewer: Cesium.Viewer) {
        this.id = "baseMapLayerManager";
        this.viewer = viewer;
    }

    getId() {
        return this.id;
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

            const apiKey = process.env.REACT_APP_VWORLD_API_KEY;
            const finalUrl = url.replace("${API_KEY}", apiKey ?? "");

            // maximumLevel 제한: 미설정 시 없는 타일 무한 요청("Failed to obtain image tile" 폭주).
            // 스타일별 실측 최대 제공 줌: 위성/일반/하이브리드 z19, midnight z18 (2D TileLayerManager 와 동일)
            const MAX_LEVEL_BY_KEY: Record<string, number> = {
                satellite: 19, base: 19, hybrid: 19, midnight: 18, osm: 19,
            };
            const provider = new Cesium.UrlTemplateImageryProvider({
                url: finalUrl, maximumLevel: MAX_LEVEL_BY_KEY[key] ?? 18,
            });
            const imageryLayer = new Cesium.ImageryLayer(provider, { show: basic });

            this.viewer.imageryLayers.add(imageryLayer);

            imageryLayer["layerGroup"] = "baseMap";
            imageryLayer["layer"] = key;

            group.push(imageryLayer);
        });
        // requestRenderMode: 이미지리 추가 후 렌더 요청 없으면 다음 카메라 조작까지
        // 배경이 회색(globe baseColor)으로 남는다.
        try { this.viewer.scene.requestRender(); } catch (_) {}
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
        try { this.viewer.scene.requestRender(); } catch (_) {}
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
        try { this.viewer.scene.requestRender(); } catch (_) {}
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
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    public get(groupName, layerName) {
        const group = this.baseLayerGroups[groupName];
        if (!group) return null;
        return group.find(layer => layer["layer"] === layerName) ?? null;
    }

    public getAllByGroup(groupName) {
        const group = this.baseLayerGroups[groupName];
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
            if (layer["layer"] === layerName && layer.alpha !== undefined) {
                layer.alpha = alpha;
            }
        });
    }

    public remove(groupName: string, layerName: string): void {
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
