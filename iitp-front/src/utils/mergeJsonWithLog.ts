import { FeatureCollection, Feature } from "geojson";
import { UpdateLogEntry} from "@stores/useHistoryStoreFactory";
import {FeatureStoreFactoryType} from "@stores/useFeatureStoreFactory";
export function mergeGeojsonWithLog(
    featureStore: FeatureStoreFactoryType,
    updateLog: UpdateLogEntry,
    isUndo: boolean
): FeatureCollection {
    const featuresMap = new Map<string | number, Feature>();
    const currentGeojson = featureStore.getState().currentGeojson as FeatureCollection;

    const updateLogJson:UpdateLogEntry = updateLog.json;

    currentGeojson.features.forEach((feature) => {
        const id = feature.properties?.id;
        if (id != null) {
            featuresMap.set(id, { ...feature });
        }
    });

    if (isUndo) {
        // Undo: 삭제 → 다시 추가
        updateLogJson.deleted?.forEach((change) => {
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
        updateLogJson.modified?.forEach((change) => {
            const feature = featuresMap.get(change.featureId);
            if (feature) {
                feature.properties = {
                    ...feature.properties,
                    [change.field]: change.oldValue,
                };
            }
        });

        // Undo: 추가됐던 피처 → 제거
        updateLogJson.added?.forEach((change) => {
            featuresMap.delete(change.featureId);
        });

    } else {
        // Redo: 삭제 → 제거
        updateLogJson.deleted?.forEach((change) => {
            featuresMap.delete(change.featureId);
        });

        // Redo: 수정 → 새로운 값으로 반영
        updateLogJson.modified?.forEach((change) => {
            const feature = featuresMap.get(change.featureId);
            if (feature) {
                feature.properties = {
                    ...feature.properties,
                    [change.field]: change.newValue,
                };
            }
        });

        // Redo: 추가 → 다시 생성 또는 속성 누적
        updateLogJson.added?.forEach((change) => {
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
