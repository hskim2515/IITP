import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useSignalStore = createFeatureStore();
export const useSignalHistoryStore = createHistoryStore();
