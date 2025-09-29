import Feature from 'ol/Feature'
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
    // 깊은 복사본 생성
    const clonedData = structuredClone(currentJsonData);

    const { added, modified, deleted } = updateLog;

    // guid 또는 id로 객체 찾기 (중첩 객체 탐색)
    function findByGuid(obj: any, guid: string): any | null {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findByGuid(item, guid);
                if (found) return found;
            }
        } else if (obj && typeof obj === "object") {
            if (obj.__guid === guid || obj.id === guid) return obj;
            for (const val of Object.values(obj)) {
                const found = findByGuid(val, guid);
                if (found) return found;
            }
        }
        return null;
    }

    // 같은 guid + timestamp 기준으로 묶기
    function groupByGuidAndTimestamp(changes: any[]): any[][] {
        const map = new Map<string, any[]>();
        changes.forEach(change => {
            const key = `${change.guid}|${change.timestamp}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(change);
        });
        return Array.from(map.values());
    }

    if (isUndo) {
        // Undo: 삭제 → 다시 추가
        groupByGuidAndTimestamp(deleted || []).forEach(group => {
            const change = group[0];
            const parts = change.guid.split(".");
            const parentGuid = parts.slice(0, -1).join(".");
            const childKeyWithIndex = parts[parts.length - 1];
            const [childKey, indexStr] = childKeyWithIndex.split("-");
            const index = parseInt(indexStr, 10);

            const parentObj = parentGuid ? findByGuid(clonedData, parentGuid) : clonedData;
            if (!parentObj) return;
            if (!Array.isArray(parentObj[childKey])) parentObj[childKey] = [];

            const restoredObj: any = {};
            group.forEach(f => {
                restoredObj[f.field!] = f.oldValue;
            });
            parentObj[childKey].splice(index, 0, restoredObj);
        });

        // Undo: 수정 → 원래 값으로 복원
        modified?.forEach(change => {
            const target = findByGuid(clonedData, change.guid);
            if (target) target[change.field!] = change.oldValue;
        });

        // Undo: 추가 → 배열에서 제거
        groupByGuidAndTimestamp(added || []).forEach(group => {
            const change = group[0];
            const parts = change.guid.split(".");
            const parentGuid = parts.slice(0, -1).join(".");
            const childKeyWithIndex = parts[parts.length - 1];
            const [childKey, indexStr] = childKeyWithIndex.split("-");
            const index = parseInt(indexStr, 10);

            const parentObj = parentGuid ? findByGuid(clonedData, parentGuid) : clonedData;
            if (!parentObj || !Array.isArray(parentObj[childKey])) return;

            parentObj[childKey].splice(index, 1);
        });

    } else {
        // Redo: 삭제 → 배열에서 제거
        groupByGuidAndTimestamp(deleted || []).forEach(group => {
            const change = group[0];
            const parts = change.guid.split(".");
            const parentGuid = parts.slice(0, -1).join(".");
            const childKeyWithIndex = parts[parts.length - 1];
            const [childKey, indexStr] = childKeyWithIndex.split("-");
            const index = parseInt(indexStr, 10);

            const parentObj = parentGuid ? findByGuid(clonedData, parentGuid) : clonedData;
            if (!parentObj || !Array.isArray(parentObj[childKey])) return;

            parentObj[childKey].splice(index, 1);
        });

        // Redo: 수정 → 새로운 값 반영
        modified?.forEach(change => {
            const target = findByGuid(clonedData, change.guid);
            if (target) target[change.field!] = change.newValue;
        });

        // Redo: 추가 → 다시 생성
        groupByGuidAndTimestamp(added || []).forEach(group => {
            const change = group[0];
            const parts = change.guid.split(".");
            const parentGuid = parts.slice(0, -1).join(".");
            const childKeyWithIndex = parts[parts.length - 1];
            const [childKey, indexStr] = childKeyWithIndex.split("-");
            const index = parseInt(indexStr, 10);

            const parentObj = parentGuid ? findByGuid(clonedData, parentGuid) : clonedData;
            if (!parentObj) return;
            if (!Array.isArray(parentObj[childKey])) parentObj[childKey] = [];

            const newObj: any = {};
            group.forEach(f => {
                newObj[f.field!] = f.newValue;
            });

            parentObj[childKey].splice(index, 0, newObj);
        });
    }

    return clonedData;
}

export function buildMergedDataFromLogs(
    baseData: Record<string,any>,
    logs: UpdateLogEntry[],
    isUndo : boolean
): Record<string,any> {
    const sortedLogs = [...logs].sort((a, b) => {
        const aTime = getLogMinTimestamp(a);
        const bTime = getLogMinTimestamp(b);
        return isUndo
            ? bTime - aTime
            : aTime - bTime;
    });

    const featuresMap = new Map<string | number, Feature>();
    baseData.forEach((item) => {
        const id = item.__guid;
        if (id != null) {
            featuresMap.set(id, item);
        }
    });

    sortedLogs.forEach(log => {
        mergeJsonWithLogRecursive(featuresMap, log.data, isUndo);
    });
    return Array.from(featuresMap.values());
}

function getLogMinTimestamp(log: UpdateLogEntry): number {
    const allTimestamps = ['added', 'modified', 'deleted']
        .flatMap(type => log[type]?.map(item => new Date(item.timestamp).getTime()) || []);
    return allTimestamps.length > 0 ? Math.min(...allTimestamps) : Infinity;
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
    const sortLogs = logs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const reversedLogs = sortLogs.map((log) => {
        const timestamp = new Date().toISOString();
        return {
            added: log.data.deleted.map((item) => ({
                ...item,
                guid: item.guid,
                field: item.field,
                oldValue: null,
                newValue: item.oldValue,
                timestamp: timestamp,
            })),
            deleted: log.data.added.map((item) => ({
                ...item,
                guid: item.guid,
                field: item.field,
                oldValue: item.newValue,
                newValue: null,
                timestamp: timestamp,
            })),
            modified: log.data.modified.map((item) => ({
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