import Feature from 'ol/Feature'
import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import { UpdateLogEntry, UpdateType } from "@type/HistoryTypes";
import { Feature as OLFeature } from "ol";
import { Point } from "ol/geom";
import {fromLonLat} from "ol/proj";
import {createFeature} from "@utils/feature";

interface FeatureUpdateHistoryOptions {
    featureId: string | number;
    updateType: UpdateType;
    field?: string;
    oldValue?: any;
    newValue?: any;
    properties?: Record<string, unknown>;
}



export function mergeJsonWithLog(
    featuresMap: Map<string | number, OLFeature>,
    updateLog: UpdateLogEntry,
    isUndo: boolean
): OLFeature[] {
    const { added, modified, deleted } = updateLog;
    if (isUndo) {
        // Undo: 삭제 → 다시 추가
        const deletedPropsMap = new Map<string | number, Record<string, any>>();
        deleted?.forEach((change) => {
            const fid = change.featureId;
            if (!deletedPropsMap.has(fid)) {
                deletedPropsMap.set(fid, {});
            }
            deletedPropsMap.get(fid)![change.field!] = change.oldValue;
        });

        deletedPropsMap.forEach((props, fid) => {
            const coords = props.coordinates?.[0];
            const geom = coords ? new Point(fromLonLat([coords.lng, coords.lat])) : new Point([0, 0]);
            const feature = new Feature({ geometry: geom });
            feature.setProperties({
                ...props,
                id: fid,
            });
            feature.setId(fid);
            featuresMap.set(fid, feature);
        });

        // Undo: 수정 → 원래 값으로 복원
        modified?.forEach((change) => {
            const feature = featuresMap.get(change.featureId);
            if (feature) {
                feature.set(change.field!, change.oldValue);
            }
        });

        // Undo: 추가 → 제거
        added?.forEach((change) => {
            featuresMap.delete(change.featureId);
        });

    } else {
        // Redo: 삭제 → 제거
        deleted?.forEach((change) => {
            featuresMap.delete(change.featureId);
        });

        // Redo: 수정 → 새로운 값 반영
        modified?.forEach((change) => {
            const feature = featuresMap.get(change.featureId);
            if (feature) {
                feature.set(change.field!, change.newValue);
            }
        });

        // Redo: 추가 → 다시 생성
        added?.forEach((change) => {
            const feature = new OLFeature({
                ...change.properties,
                id: change.featureId,
            });

            // geometry가 없다면 기본 geometry 설정
            if (!feature.getGeometry()) {
                feature.setGeometry(new Point([0, 0]));
            }

            featuresMap.set(change.featureId, feature);
        });
    }

    return Array.from(featuresMap.values());
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
    const features = baseData
        .map((data) => createFeature(data))
        .filter((f): f is Feature<Point> => !!f);

    features.forEach((feature) => {
        if (!feature) return;
        const id = feature.get('id');
        if (id != null) {
            featuresMap.set(id, feature);
        }
    });

    sortedLogs.forEach(log => {
        mergeJsonWithLog(featuresMap, log.data, isUndo);
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

export function getValueAtPath(obj: any, path: string[]) {
    return path.reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : undefined, obj);
}