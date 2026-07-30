import { create } from 'zustand';
import React from "react";

type SelectionGroup = Record<string, (string | React.Key)[]>;

/** 선택이 어디서 발생했는지 — 'grid'(그리드/에디터 행 선택)만 카메라 fly-to/줌을 동반한다.
 *  'map'(지도 클릭)은 하이라이트만 하고 카메라를 움직이지 않는다. */
export type SelectionSource = 'map' | 'grid';

type SelectionStore = {
    selectedGuid: (string | React.Key)[];
    groupedByType: SelectionGroup;
    selectionSource: SelectionSource;

    setSelectedGuid: (guids: (string | React.Key)[], source?: SelectionSource) => void;
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
    selectionSource: 'map',

    setSelectedGuid: (guids, source = 'map') => {
        set({
            selectedGuid: guids,
            groupedByType: groupGuidsByType(guids),
            selectionSource: source,
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
