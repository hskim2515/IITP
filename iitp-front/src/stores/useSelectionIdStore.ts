import { create } from "zustand";
import { combine, subscribeWithSelector } from "zustand/middleware";

interface State {
    selectionId: Array<string | number>;
}

interface Actions {
    setSelectionId: (ids: Array<string | number>) => void;
    addSelectionId: (id: string | number) => void;
    removeSelectionId: (id: string | number) => void;
    clearSelectionId: () => void;
}

const initialState: State = {
    selectionId: [],
};

const useSelectionIdStore = create<State & Actions>()(
    subscribeWithSelector(
        combine(initialState, (set, get) => ({
            setSelectionId: (ids) =>
                set((state) => {
                    if (JSON.stringify(state.selectionId) === JSON.stringify(ids)) return state;
                    return { selectionId: ids };
                }),
            addSelectionId: (id) => {
                const current = get().selectionId;
                if (!current.includes(id)) {
                    set({ selectionId: [...current, id] });
                }
            },
            removeSelectionId: (id) => {
                const current = get().selectionId;
                set({ selectionId: current.filter((item) => item !== id) });
            },
            clearSelectionId: () => set({ selectionId: [] }),
        }))
    )
);

export default useSelectionIdStore;
