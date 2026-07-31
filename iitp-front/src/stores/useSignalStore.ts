import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useSignalStore = createFeatureStore();
export const useSignalTurnHistoryStore = createHistoryStore();
export const useSignalPlanHistoryStore = createHistoryStore();

// 기존 이동류 편집 및 외부 호출부 호환용 이름이다.
export const useSignalHistoryStore = useSignalTurnHistoryStore;
