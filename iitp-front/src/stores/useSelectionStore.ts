import { create } from 'zustand';

type SelectionStore = {
    selectedGuid: (string | number) [];
    setSelectedGuid: (guids: (string)[]) => void;

    addSelectionId: (guid: string | number) => void;
    removeSelectionId: (guid: string | number) => void;
    clearSelected: () => void;
};

export const useSelectionStore = create<SelectionStore>((set, get) => ({
    selectedGuid: [],
    setSelectedGuid: (guids: (string)[]) => {
        set({selectedGuid: guids})
    },
    addSelectionId: (guid: string | number) => {
        const currentSelected = get().selectedGuid;
        if (!currentSelected.includes(guid)) set({selectedGuid: [...currentSelected, guid]});
    },
    removeSelectionId: (guid: string | number) => {
        const currentSelected = get().selectedGuid;
        set({selectedGuid: currentSelected.filter((id: string | number) => id !== guid)});
    },
    clearSelected: () => set({selectedGuid: []}),
}));
