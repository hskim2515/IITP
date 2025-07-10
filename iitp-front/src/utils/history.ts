import { Feature, FeatureCollection } from "geojson";
import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import { UpdateLogEntry, UpdateType } from "@type/HistoryTypes";

interface FeatureUpdateHistoryOptions {
    featureId: string | number;
    updateType: UpdateType;
    field?: string;
    oldValue?: any;
    newValue?: any;
    properties?: Record<string, unknown>;
}

export function mergeJsonWithLog(
    featuresMap: Map<string | number, Feature>,
    updateLog: UpdateLogEntry,
    isUndo: boolean
): FeatureCollection {
    const { added, modified, deleted } = updateLog;
    if (isUndo) {
        // Undo: 삭제 → 다시 추가
        deleted?.forEach((change) => {
            const existing = featuresMap.get(change.featureId);
            const newProps = {
                ...(existing?.properties ?? {}),
                id: change.featureId,
                [change.field]: change.oldValue,
            };

            featuresMap.set(change.featureId, {
                type: "Feature",
                geometry: existing?.geometry ?? { type: "Point", coordinates: [0, 0] },
                properties: newProps,
            });
        });

        // Undo: 수정 → 원래 값으로 복원
        modified?.forEach((change) => {
            const feature = featuresMap.get(change.featureId);
            if (feature) {
                feature.properties = {
                    ...feature.properties,
                    [change.field]: change.oldValue,
                };
            }
        });

        // Undo: 추가됐던 피처 → 제거
        added?.forEach((change) => {
            featuresMap.delete(change.featureId);
        });

    } else {
        // Redo: 삭제 → 제거
        deleted?.forEach((change) => {
            featuresMap.delete(change.featureId);
        });

        // Redo: 수정 → 새로운 값으로 반영
        modified?.forEach((change) => {
            const feature = featuresMap.get(change.featureId);
            if (feature) {
                feature.properties = {
                    ...feature.properties,
                    [change.field]: change.newValue,
                };
            }
        });

        // Redo: 추가 → 다시 생성 또는 속성 누적
        added?.forEach((change) => {
            const existing = featuresMap.get(change.featureId);
            const id = change.featureId;

            const newProps = {
                ...(existing?.properties ?? {}),
                id,
                [change.field]: change.newValue,
            };

            featuresMap.set(id, {
                type: "Feature",
                geometry: existing?.geometry ?? { type: "Point", coordinates: [0, 0] },
                properties: newProps,
            });
        });
    }

    return {
        type: "FeatureCollection",
        features: Array.from(featuresMap.values()),
    };
}

export function buildJsonFromLogs(
    baseGeojson: FeatureCollection,
    logs: UpdateLogEntry[],
    isUndo : boolean
): FeatureCollection {

    const sortedLogs = [...logs].sort((a, b) => {
        const aTime = getLogMinTimestamp(a);
        const bTime = getLogMinTimestamp(b);
        return isUndo
            ? bTime - aTime
            : aTime - bTime;
    });

    const featuresMap = new Map<string | number, Feature>();
    baseGeojson.features.forEach(feature => {
        const id = feature.properties?.id;
        if (id != null) {
            featuresMap.set(id, { ...feature });
        }
    });

    sortedLogs.forEach(log => {
        mergeJsonWithLog(featuresMap, log, isUndo);
    });

    return {
        type: "FeatureCollection",
        features: Array.from(featuresMap.values()),
    };
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
    const { featureId, updateType, field, oldValue, newValue, properties } = options;
    let updates: UpdateLogEntry = {};

    const timestamp = new Date().toISOString();

    if (updateType === "modified" && field !== undefined) {
        updates[updateType] = [
            {
                featureId,
                field,
                oldValue,
                newValue,
                timestamp
            }
        ];
    }

    if ((updateType === "added" || updateType === "deleted") && properties) {
        updates[updateType] = Object.entries(properties).map(([key, value]) => ({
            featureId,
            field: key,
            oldValue: updateType === "deleted" ? value : null,
            newValue: updateType === "added" ? value : null,
            timestamp
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