import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";
import { Network } from "@type/Network";

export const useNetworkStore = createFeatureStore<Network>();
export const useNetworkHistoryStore = createHistoryStore();