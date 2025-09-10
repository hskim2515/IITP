import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";
import { RailPublicStationResponse } from "@type/Station";

export const useRailStationStore = createFeatureStore<RailPublicStationResponse>();
export const useRailStationHistoryStore = createHistoryStore();