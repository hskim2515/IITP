import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";
import { BusPublicStationResponse, BusStationData } from "@type/Station";

export const useBusStationStore = createFeatureStore<BusPublicStationResponse>();
export const useBusStationHistoryStore = createHistoryStore();