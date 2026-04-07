import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";

export const useSimulationScenarioStore = createFeatureStore();
export const useSimulationScenarioHistoryStore = createHistoryStore();
