import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useBusPtLineStore = createFeatureStore();
export const useBusPtLineWeekdayStore = createFeatureStore();
export const useBusPtLineWeekendStore = createFeatureStore();

export const useBusPtLineHistoryStore = createHistoryStore();
export const useBusPtLineWeekdayHistoryStore = createHistoryStore();
export const useBusPtLineWeekendHistoryStore = createHistoryStore();
