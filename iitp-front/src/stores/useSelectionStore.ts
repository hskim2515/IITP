import { create } from 'zustand';
import React from "react";

type SelectionStore = {
    selectedGuid: (string | React.Key) [];
    setSelectedGuid: (guids: (string | React.Key)[]) => void;

    addSelectionId: (guid: string | React.Key) => void;
    removeSelectionId: (guid: string | React.Key) => void;
    clearSelected: () => void;
};

export const useSelectionStore = create<SelectionStore>((set, get) => ({
    selectedGuid: [],
    setSelectedGuid: (guids: (string | React.Key) []) => {
        set({selectedGuid: guids})
    },
    addSelectionId: (guid: string | React.Key) => {
        const currentSelected = get().selectedGuid;
        if (!currentSelected.includes(guid)) set({selectedGuid: [...currentSelected, guid]});
    },
    removeSelectionId: (guid: string | number | React.Key) => {
        const currentSelected = get().selectedGuid;
        set({selectedGuid: currentSelected.filter((id: string | number | React.Key) => id !== guid)});
    },
    clearSelected: () => set({selectedGuid: []}),
}));
