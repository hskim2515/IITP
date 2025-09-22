import { create } from 'zustand';
import React from "react";

type SelectionGroup = Record<string, (string | React.Key)[]>;

type SelectionStore = {
    selectedGuid: (string | React.Key)[];
    groupedByType: SelectionGroup;

    setSelectedGuid: (guids: (string | React.Key)[]) => void;
    addSelectionId: (guid: string | React.Key) => void;
    removeSelectionId: (guid: string | React.Key) => void;
    clearSelected: () => void;
};

function getFeatureTypeFromGuid(guid: string | React.Key): string {
    if (typeof guid !== "string") return "unknown";
    const [prefix] = guid.split("-");
    return prefix || "unknown";
}

/** guid 배열 → featureType별 그룹 */
function groupGuidsByType(guids: (string | React.Key)[]): SelectionGroup {
    return guids.reduce((acc, guid) => {
        const type = getFeatureTypeFromGuid(guid);
        if (!acc[type]) acc[type] = [];
        acc[type].push(guid);
        return acc;
    }, {} as SelectionGroup);
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
    selectedGuid: [],
    groupedByType: {},

    setSelectedGuid: (guids) => {
        set({
            selectedGuid: guids,
            groupedByType: groupGuidsByType(guids),
        });
    },

    addSelectionId: (guid) => {
        const currentSelected = get().selectedGuid;
        if (!currentSelected.includes(guid)) {
            const newGuids = [...currentSelected, guid];
            set({
                selectedGuid: newGuids,
                groupedByType: groupGuidsByType(newGuids),
            });
        }
    },

    removeSelectionId: (guid) => {
        const currentSelected = get().selectedGuid;
        const newGuids = currentSelected.filter((id) => id !== guid);
        set({
            selectedGuid: newGuids,
            groupedByType: groupGuidsByType(newGuids),
        });
    },

    clearSelected: () => set({
        selectedGuid: [],
        groupedByType: {},
    }),
}));
