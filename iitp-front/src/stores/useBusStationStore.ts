import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";
import { BusStationData } from "@type/Station";

export const useBusStationStore = createFeatureStore<BusStationData>();
export const useBusStationHistoryStore = createHistoryStore();