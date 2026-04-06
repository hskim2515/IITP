import * as Cesium from "cesium";
import BusStationDataSourceLayer from "../datasource/BusStationDataSourceLayer";

class DataSourceLayerManager {
    private id: string;
    private viewer: Cesium.Viewer;
    private layerGroups: Record<string, Map<string, Cesium.DataSource>>; // { groupName: Map<layerName, DataSource> }
    private onAdd: ((ds: Cesium.DataSource, groupName: string, layerName: string) => void) | null;
    private onRemove: ((ds: Cesium.DataSource, groupName: string, layerName: string) => void) | null;
    private layerStore: any;

    constructor(viewer: Cesium.Viewer, layerStore: any) {
        this.id = "dataSourceLayerManager";
        this.viewer = viewer;
        this.layerGroups = {};
        this.onAdd = null;
        this.onRemove = null;
        this.layerStore = layerStore;
    }

    getId(): string {
        return this.id;
    }

    private _getOrCreateGroup(groupName: string): Map<string, Cesium.DataSource> {
        if (!this.layerGroups[groupName]) {
            this.layerGroups[groupName] = new Map<string, Cesium.DataSource>();
        }
        return this.layerGroups[groupName];
    }

    add(ds, groupName, layerName, basic): void {
        const group = this._getOrCreateGroup(groupName);
        ds.dataSource.show = basic
        group.set(layerName, ds);

        //await this.viewer.dataSources.add(ds);

        this.layerStore.getState().activeLayerName?.forEach((activeLayerName: string) => {
            if (activeLayerName === layerName) {
                this.show(groupName, layerName);
            }
        });

        if (this.onAdd) {
            this.onAdd(ds, groupName, layerName);
        }
    }

    get(groupName: string, layerName: string): Cesium.DataSource | undefined {
        const group = this.layerGroups[groupName];
        return group?.get(layerName)?.dataSource;
    }

    getAllByGroup(groupName: string): Cesium.DataSource[] {
        const group = this.layerGroups[groupName];
        return group ? Array.from(group.values()) : [];
    }

    getAllLayerNames(groupName: string): string[] {
        const group = this.layerGroups[groupName];
        return group ? Array.from(group.keys()) : [];
    }

    show(groupName: string, layerName: string): void {
        const ds = this.get(groupName, layerName);
        if (ds) ds.show = true;
    }

    hide(groupName: string, layerName: string): void {
        const ds = this.get(groupName, layerName);
        if (ds) ds.show = false;
    }

    hideAll(groupName: string): void {
        const group = this.layerGroups[groupName];
        if (!group) return;
        group.forEach(ds => (ds.show = false));
    }

    toggle(groupName: string, layerName: string): void {
        const ds = this.get(groupName, layerName);
        if (!ds) return;
        ds.show = !ds.show;
    }

    toggleByFeatureType(groupName: string, layerName: string, featureType: string, visible: boolean): void {
        const ds = this.get(groupName, layerName);
        if (!ds) return;

        // 부모 DataSource가 숨겨진 상태면 entity 토글이 무의미함
        // visible=true일 때 부모도 함께 show
        if (visible && !ds.show) {
            ds.show = true;
        }

        ds.entities.values.forEach(entity => {
            const entityFeatureType = entity?.properties?.featureType?.getValue?.();
            if (entityFeatureType === featureType) {
                entity.show = visible;
            }
        });

        // 모든 entity가 숨겨진 경우 부모 DataSource도 hide
        if (!visible) {
            const anyVisible = ds.entities.values.some(e => e.show);
            if (!anyVisible) ds.show = false;
        }
    }


    remove(groupName: string, layerName: string): void {
        const group = this.layerGroups[groupName];
        const ds = group?.get(layerName);
        if (!group || !ds) return;

        // ds는 DataSourceLayer 래퍼 인스턴스이므로 .dataSource로 실제 DataSource를 제거
        const actualDs = (ds as any).dataSource ?? ds;
        this.viewer.dataSources.remove(actualDs, true);
        group.delete(layerName);

        if (this.onRemove) {
            this.onRemove(ds, groupName, layerName);
        }
    }

    removeGroup(groupName: string): void {
        const group = this.layerGroups[groupName];
        if (!group) return;
        group.forEach(ds => this.viewer.dataSources.remove(ds, true));
        delete this.layerGroups[groupName];
    }

    getAllGroups(): string[] {
        return Object.keys(this.layerGroups);
    }

    getAllByGroupGrouped(groupName: string): Record<string, Cesium.DataSource> {
        const group = this.layerGroups[groupName];
        if (!group) return {};
        const result: Record<string, Cesium.DataSource> = {};
        group.forEach((ds, layerName) => {
            result[layerName] = ds;
        });
        return result;
    }

    setOnAddCallback(callback: (ds: Cesium.DataSource, groupName: string, layerName: string) => void): void {
        this.onAdd = callback;
    }

    setOnRemoveCallback(callback: (ds: Cesium.DataSource, groupName: string, layerName: string) => void): void {
        this.onRemove = callback;
    }
}

export default DataSourceLayerManager;
