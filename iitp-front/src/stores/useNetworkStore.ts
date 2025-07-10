import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useNetworkStore = createFeatureStore();
export const useNetworkHistoryStore = createHistoryStore();