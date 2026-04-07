import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useRouteStore = createFeatureStore();
export const usePaxRouteStore = createFeatureStore();

export const useRouteHistoryStore = createHistoryStore();
export const usePaxRouteHistoryStore = createHistoryStore();
