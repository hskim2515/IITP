import useFeatureStoreFactory, {UpdateLogEntry, UpdateType} from "@stores/useFeatureStoreFactory";

interface FeatureUpdateHistoryOptions {
    versionId: string;
    featureId: string | number;
    updateType: UpdateType;
    field?: string;
    oldValue?: any;
    newValue?: any;
    properties?: Record<string, unknown>;
}

export const featureUpdateLogs = (
    store: ReturnType<typeof useFeatureStoreFactory>,
    options: FeatureUpdateHistoryOptions
) => {
    const { versionId, featureId, updateType, field, oldValue, newValue, properties } = options;
    let updates: UpdateLogEntry = {};

    if (updateType === "modified" && field !== undefined) {
        updates[updateType] = [
            {
                featureId,
                field,
                oldValue,
                newValue
            }
        ];
    }

    if ((updateType === "added" || updateType === "deleted") && properties) {
        updates[updateType] = Object.entries(properties).map(([key, value]) => ({
            featureId,
            field: key,
            oldValue: updateType === "deleted" ? value : null,
            newValue: updateType === "added" ? value : null,
        }));
    }

    if (Object.keys(updates).length > 0) {
        store.getState().addFieldUpdate(versionId, updates);
    }
    console.log("[updateLogs]", store.getState().updateLogs);
};