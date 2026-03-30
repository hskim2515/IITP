import createFeatureStore from "@stores/useFeatureStoreFactory";
import createHistoryStore from "@stores/useHistoryStoreFactory";
import {Network, Node} from "@type/Network";

export const useNodeStore = createFeatureStore<Node>();
export const useNodeHistoryStore = createHistoryStore();