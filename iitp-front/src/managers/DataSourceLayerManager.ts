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

        // 맵에 추적된 기존 DataSource 제거
        const existing = group.get(layerName);
        if (existing) {
            if ((existing as any).destroy) {
                // destroy()가 있으면 모든 정리(dataSource, primitives, unsubscribes)를 위임
                (existing as any).destroy();
            } else {
                const existingDs = (existing as any).dataSource ?? existing;
                this.viewer.dataSources.remove(existingDs, true);
                if ((existing as any).unsubscribe) (existing as any).unsubscribe();
            }
        }

        // viewer에 남아 있는 동일 name의 모든 DataSource도 제거 (중복 누적 방지)
        const newDs = (ds as any).dataSource ?? ds;
        const toRemove: Cesium.DataSource[] = [];
        for (let i = 0; i < this.viewer.dataSources.length; i++) {
            const d = this.viewer.dataSources.get(i);
            if (d !== newDs && (d as any).name === layerName) {
                toRemove.push(d);
            }
        }
        toRemove.forEach(d => this.viewer.dataSources.remove(d, true));

        ds.dataSource.show = basic;
        ds?.setVisible?.(basic);
        group.set(layerName, ds);

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
        const stored = group?.get(layerName) as any;
        return stored?.dataSource ?? stored;
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
        const group = this.layerGroups[groupName];
        const stored = group?.get(layerName) as any;
        const ds = stored?.dataSource ?? stored;
        if (ds) ds.show = true;
        stored?.setVisible?.(true);
    }

    hide(groupName: string, layerName: string): void {
        const group = this.layerGroups[groupName];
        const stored = group?.get(layerName) as any;
        const ds = stored?.dataSource ?? stored;
        if (ds) ds.show = false;
        stored?.setVisible?.(false);
    }

    hideAll(groupName: string): void {
        const group = this.layerGroups[groupName];
        if (!group) return;
        group.forEach((stored: any) => {
            const ds = stored?.dataSource ?? stored;
            if (ds) ds.show = false;
            stored?.setVisible?.(false);
        });
    }

    toggle(groupName: string, layerName: string): void {
        const group = this.layerGroups[groupName];
        const stored = group?.get(layerName) as any;
        const ds = stored?.dataSource ?? stored;
        if (!ds) return;
        const next = !ds.show;
        ds.show = next;
        stored?.setVisible?.(next);
    }

    toggleByFeatureType(groupName: string, layerName: string, featureType: string, visible: boolean): void {
        const group = this.layerGroups[groupName];
        const stored = group?.get(layerName) as any;
        // Primitive 기반 featureType (links, lanes)은 레이어 인스턴스에 위임
        if (stored?.toggleFeatureTypeVisible) {
            stored.toggleFeatureTypeVisible(featureType, visible);
        }

        const ds = this.get(groupName, layerName);
        if (!ds) return;

        // 부모 DataSource가 숨겨진 상태면 entity 토글이 무의미함
        // visible=true일 때 부모도 함께 show
        if (visible && !ds.show) {
            ds.show = true;
        }

        ds.entities.values.forEach(entity => {
            // __guid 패턴 "links-0.lanes-0" 에서 마지막 세그먼트의 타입 추출
            const entityId = String(entity.id ?? "");
            const lastSegment = entityId.split(".").pop() ?? "";
            const entityFeatureType = lastSegment.split("-")[0];
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
        const stored = group?.get(layerName);
        if (!group || !stored) return;

        if ((stored as any).destroy) {
            (stored as any).destroy();
        } else {
            const actualDs = (stored as any).dataSource ?? stored;
            this.viewer.dataSources.remove(actualDs, true);
        }
        group.delete(layerName);

        if (this.onRemove) {
            this.onRemove(stored, groupName, layerName);
        }
    }

    removeGroup(groupName: string): void {
        const group = this.layerGroups[groupName];
        if (!group) return;
        group.forEach((stored: any) => {
            if (stored?.destroy) {
                stored.destroy();
            } else {
                const ds = stored?.dataSource ?? stored;
                if (ds) this.viewer.dataSources.remove(ds, true);
            }
        });
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
