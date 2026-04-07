import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import {UpdateLogEntry, UpdateLogItem, UpdateType} from "@type/HistoryTypes";
import { Feature as OLFeature } from "ol";
import { Point } from "ol/geom";
import {fromLonLat} from "ol/proj";
import {createFeature} from "@utils/feature";
import {useMessageStore} from "@stores/useMessageStore";

interface FeatureUpdateHistoryOptions {
    guid: string | number;
    updateType: UpdateType;
    field?: string;
    oldValue?: any;
    newValue?: any;
    properties?: Record<string, unknown>;
    parentGuid?: string;
    grandParentGuid?: string;
}

const setMessage = useMessageStore.getState().setMessage;

function updateFeatureByGuid(obj: any, guid: string, updater: (feature: any) => void): boolean {
    if (Array.isArray(obj)) {
        return obj.some(item => updateFeatureByGuid(item, guid, updater));
    }

    if (obj instanceof Map) {
        for (const value of obj.values()) {
            if (updateFeatureByGuid(value, guid, updater)) return true;
        }
        return false;
    }

    if (obj && typeof obj === "object") {
        if (obj.__guid === guid || obj.id === guid) {
            updater(obj);
            setMessage({
                type: 'info',
                text: "성공",
            });
            return true; // 찾았으니 중단
        }
        return Object.values(obj).some(value => updateFeatureByGuid(value, guid, updater));
    }
    return false;
}
export function mergeJsonWithLogRecursive(
    currentJsonData: any,
    updateLog: UpdateLogEntry,
    isUndo: boolean
): any {
    const clonedData = structuredClone(currentJsonData);
    const { added, modified, deleted } = updateLog;

    function findByGuid(obj: any, guid: string): any | null {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findByGuid(item, guid);
                if (found) return found;
            }
        } else if (obj && typeof obj === "object") {
            if (obj.__guid === guid) return obj;
            for (const val of Object.values(obj)) {
                const found = findByGuid(val, guid);
                if (found) return found;
            }
        }
        return null;
    }

    function groupByGuid(changes: any[]): any[][] {
        const map = new Map<string, any[]>();
        changes.forEach(change => {
            if (!map.has(change.guid)) map.set(change.guid, []);
            map.get(change.guid)!.push(change);
        });
        return Array.from(map.values());
    }

    function resolveParentAndIndex(guid: string): {
        parentObj: any;
        childKey: string;
        index: number;
    } | null {
        const parts = guid.split(".");

        if (parts.length === 1) {
            const lastDashIdx = guid.lastIndexOf("-");
            const childKey = guid.substring(0, lastDashIdx);
            const index = parseInt(guid.substring(lastDashIdx + 1), 10);
            return { parentObj: clonedData, childKey, index };
        } else {
            const parentGuid = parts.slice(0, -1).join(".");
            const lastPart = parts[parts.length - 1];
            const lastDashIdx = lastPart.lastIndexOf("-");
            const childKey = lastPart.substring(0, lastDashIdx);
            const index = parseInt(lastPart.substring(lastDashIdx + 1), 10);

            const parentObj = findByGuid(clonedData, parentGuid);
            if (!parentObj) return null;

            return { parentObj, childKey, index };
        }
    }

    function removeItem(guid: string) {
        const resolved = resolveParentAndIndex(guid);
        if (!resolved) return;
        const { parentObj, childKey } = resolved;
        if (!Array.isArray(parentObj[childKey])) return;

        const idx = parentObj[childKey].findIndex((item: any) => item.__guid === guid);
        if (idx !== -1) parentObj[childKey].splice(idx, 1);
    }

    function addItem(guid: string, obj: any) {
        const resolved = resolveParentAndIndex(guid);
        if (!resolved) return;
        const { parentObj, childKey, index } = resolved;
        if (!Array.isArray(parentObj[childKey])) parentObj[childKey] = [];

        const exists = parentObj[childKey].some((item: any) => item.__guid === guid);
        if (!exists) parentObj[childKey].splice(index, 0, obj);
    }

    if (isUndo) {
        const deletedGroups = groupByGuid(deleted || []);
        deletedGroups
            .sort((a, b) => {
                const aResolved = resolveParentAndIndex(a[0].guid);
                const bResolved = resolveParentAndIndex(b[0].guid);
                return (aResolved?.index ?? 0) - (bResolved?.index ?? 0);
            })
            .forEach(group => {
                const restoredObj: any = {};
                group.forEach(f => { restoredObj[f.field!] = f.oldValue; });
                addItem(group[0].guid, restoredObj);
            });

        modified?.forEach(change => {
            const target = findByGuid(clonedData, change.guid);
            if (target) target[change.field!] = change.oldValue;
        });

        groupByGuid(added || []).forEach(group => {
            removeItem(group[0].guid);
        });

    } else {
        groupByGuid(deleted || []).forEach(group => {
            removeItem(group[0].guid);
        });

        modified?.forEach(change => {
            const target = findByGuid(clonedData, change.guid);
            if (target) target[change.field!] = change.newValue;
        });

        groupByGuid(added || []).forEach(group => {
            const newObj: any = {};
            group.forEach(f => { newObj[f.field!] = f.newValue; });
            addItem(group[0].guid, newObj);
        });
    }

    return clonedData;
}

export function buildMergedDataFromLogs(
    baseData: any[],
    logs: Array<{ createdAt: string; data: UpdateLogEntry }>,
    isUndo: boolean
): any[] {
    const sortedLogs = [...logs].sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return isUndo ? bTime - aTime : aTime - bTime;
    });

    let result: any = baseData;
    sortedLogs.forEach(log => {
        if (log.data) {
            result = mergeJsonWithLogRecursive(result, log.data, isUndo);
        }
    });
    return result;
}

//변경이력 쌓기
export const featureUpdateLogs = (
    store: ReturnType<typeof useHistoryStoreFactory>,
    options: FeatureUpdateHistoryOptions
) => {
    const { guid, updateType, field, oldValue, newValue, properties } = options;
    let updates: UpdateLogEntry = {};
    const timestamp = new Date().toISOString();

    if (field === "geometry.coordinates" || field === "coordinates") {
        return;
    }

    if (updateType === "modified" && field !== undefined) {
        updates[updateType] = [
            {
                guid,
                field,
                oldValue,
                newValue,
                timestamp,
            }
        ];
    }

    if ((updateType === "added" || updateType === "deleted") && properties) {
        updates[updateType] = Object.entries(properties).map(([key, value]) => ({
            guid,
            field: key,
            oldValue: updateType === "deleted" ? value : null,
            newValue: updateType === "added" ? value : null,
            timestamp,
            properties,
        }));
    }

    if (Object.keys(updates).length > 0) {
        store.getState().setUpdateLogs(updates);
    }

    console.log("[updateLogs]", store.getState().updateLogs);
};
export const featureReverseLogs = (
    store: ReturnType<typeof useHistoryStoreFactory>,
    logs: any
) => {
    if(store.getState().snapshotUpdateLogs){
        store.getState().resetSnapshotUpdateLogs();
    }
    if(store.getState().updateLogs){
        store.getState().resetUpdateLogs();
    }
    const sortLogs = [...logs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const reversedLogs = sortLogs.map((log) => {
        const timestamp = new Date().toISOString();
        return {
            added: (log.data?.deleted ?? []).map((item) => ({
                ...item,
                guid: item.guid,
                field: item.field,
                oldValue: null,
                newValue: item.oldValue,
                timestamp: timestamp,
            })),
            deleted: (log.data?.added ?? []).map((item) => ({
                ...item,
                guid: item.guid,
                field: item.field,
                oldValue: item.newValue,
                newValue: null,
                timestamp: timestamp,
            })),
            modified: (log.data?.modified ?? []).map((item) => ({
                ...item,
                guid: item.guid,
                field: item.field,
                oldValue: item.newValue,
                newValue: item.oldValue,
                timestamp: timestamp,
            })),
        };
    });

    reversedLogs.forEach((updates) => {
        if (Object.keys(updates).length > 0) {
            store.getState().setSnapshotUpdateLogs(updates);
        }
    });

    console.log("[snapshotUpdateLogs]", store.getState().snapshotUpdateLogs);
};

export function mergeUpdateLogs(logs: UpdateLogItem[], snapshotLogs: UpdateLogItem[]): UpdateLogEntry {
    const allLogs = [...snapshotLogs, ...logs];

    allLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const merged: UpdateLogEntry = { added: [], modified: [], deleted: [] };

    for (const log of allLogs) {
        log.json.added?.forEach(change => merged.added!.push(change));
        log.json.modified?.forEach(change => merged.modified!.push(change));
        log.json.deleted?.forEach(change => merged.deleted!.push(change));
    }

    return merged;
}