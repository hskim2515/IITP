import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useSignalTodStore = createFeatureStore();
export const useSignalTodHistoryStore = createHistoryStore();
