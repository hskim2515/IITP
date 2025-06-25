import { create } from 'zustand';

type SelectionStore = {
    selectedGuid: string | null;
    setSelectedGuid: (guid: string | null) => void;
};

export const useSelectionStore = create<SelectionStore>((set) => ({
    selectedGuid: null,
    setSelectedGuid: (guid) => set({ selectedGuid: guid }),
}));
