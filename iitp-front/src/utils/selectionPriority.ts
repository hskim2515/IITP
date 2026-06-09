import { FeatureLike } from "ol/Feature";

export type OlSelectionCandidate<TLayer = unknown> = {
    feature: FeatureLike;
    layer: TLayer;
    priority: number;
};

const NETWORK_LINK_TYPES = new Set(["links", "link-edit"]);
const NETWORK_CHILD_TYPES = new Set(["lanes", "lane-edit", "cells", "segments"]);

const getSelectedNetworkLinkGuid = (selectedGuids: readonly unknown[] = []): string | null => {
    const currentGuid = selectedGuids[0];
    if (typeof currentGuid !== "string") return null;

    const [rootGuid] = currentGuid.split(".");
    return rootGuid?.startsWith("links-") ? rootGuid : null;
};

export const getOlSelectionPriority = (
    feature: FeatureLike,
    selectedGuids: readonly unknown[] = []
): number => {
    const featureType = feature.get("featureType");
    const guid = feature.get("__guid");

    if (featureType === "nodes") return 0;

    const selectedLinkGuid = getSelectedNetworkLinkGuid(selectedGuids);
    const isSelectedNetworkChild = selectedLinkGuid &&
        typeof guid === "string" &&
        guid.startsWith(`${selectedLinkGuid}.`);

    if (isSelectedNetworkChild && NETWORK_CHILD_TYPES.has(String(featureType))) return 1;
    if (NETWORK_LINK_TYPES.has(String(featureType))) return selectedLinkGuid ? 2 : 1;
    if (NETWORK_CHILD_TYPES.has(String(featureType))) return selectedLinkGuid ? 3 : 2;

    return 100;
};

export const sortOlSelectionCandidates = <TLayer>(
    candidates: OlSelectionCandidate<TLayer>[]
): OlSelectionCandidate<TLayer>[] => {
    return candidates.sort((a, b) => a.priority - b.priority);
};
