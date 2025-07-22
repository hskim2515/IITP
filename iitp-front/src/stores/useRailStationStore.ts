import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";
import { RailStationData } from "@type/Station";

export const useRailStationStore = createFeatureStore();
export const useRailStationHistoryStore = createHistoryStore();