import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useRailPtLineStore = createFeatureStore();
export const useRailPtLineHistoryStore = createHistoryStore();
