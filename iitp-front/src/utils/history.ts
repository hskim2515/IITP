import Feature from 'ol/Feature'
import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import { UpdateLogEntry, UpdateType } from "@type/HistoryTypes";
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
    currentJsonData: unknown,
    updateLog: UpdateLogEntry,
    isUndo: boolean
): any {
    const { added, modified, deleted } = updateLog;

    if (isUndo) {
        // Undo: 삭제 → 다시 추가
        deleted?.forEach(change => {
            updateFeatureByGuid(currentJsonData, change.guid, feature => {
                feature[change.field!] = change.oldValue;
            });
        });

        // Undo: 수정 → 원래 값으로 복원
        modified?.forEach(change => {
            updateFeatureByGuid(currentJsonData, change.guid, feature => {
                feature[change.field!] = change.oldValue;
            });
        });

        // Undo: 추가 → 제거
        added?.forEach(change => {
            updateFeatureByGuid(currentJsonData, change.guid, feature => {
                Object.keys(feature).forEach(k => delete feature[k]);
            });
        });

    } else {
        // Redo: 삭제 → 제거
        deleted?.forEach(change => {
            updateFeatureByGuid(currentJsonData, change.guid, feature => {
                Object.keys(feature).forEach(k => delete feature[k]);
            });
        });

        // Redo: 수정 → 새로운 값 반영
        modified?.forEach(change => {
            updateFeatureByGuid(currentJsonData, change.guid, feature => {
                feature[change.field!] = change.newValue;
            });
        });

        // Redo: 추가 → 다시 생성
        added?.forEach(change => {
            updateFeatureByGuid(currentJsonData, change.guid, feature => {
                Object.assign(feature, { id: change.guid, ...change.properties });
            });
        });
    }

    return currentJsonData;
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
        store.getState().addFieldUpdate(updates);
    }

    console.log("[updateLogs]", store.getState().updateLogs);
};

export function mergeUpdateLogs(logs: any[]): UpdateLogEntry {

    const merged: UpdateLogEntry = { added: [], modified: [], deleted: [] };

    for (const log of logs) {
        log.json.added?.forEach(change => merged.added!.push(change));
        log.json.modified?.forEach(change => merged.modified!.push(change));
        log.json.deleted?.forEach(change => merged.deleted!.push(change));
    }

    return merged;
}

export function getValueAtPath(obj: any, path: string[]) {
    return path.reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : undefined, obj);
}

// export function findPath(obj, guid, currentPath = ''): string | null {
//     if (Array.isArray(obj)) {
//         for (const [i, item] of obj.entries()) {
//             const result = findPath(item, guid, `${currentPath}[${i}]`);
//             if (result) return result;
//         }
//     } else if (typeof obj === 'object' && obj !== null) {
//         if (obj.__guid === guid) return currentPath;
//         for (const [key, value] of Object.entries(obj)) {
//             const result = findPath(value, guid, currentPath ? `${currentPath}.${key}` : key);
//             if (result) return result;
//         }
//     }
//     return null;
// }
