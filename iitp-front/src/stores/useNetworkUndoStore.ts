import { create } from 'zustand';
import { Network } from '@type/Network';

const MAX_UNDO = 50;

interface NetworkUndoState {
    undoStack: Network[];
    redoStack: Network[];
    push: (snapshot: Network) => void;
    undo: (current: Network) => Network | null;
    redo: (current: Network) => Network | null;
    clear: () => void;
}

export const useNetworkUndoStore = create<NetworkUndoState>((set, get) => ({
    undoStack: [],
    redoStack: [],

    push: (snapshot) => set(s => ({
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot],
        redoStack: [],
    })),

    undo: (current) => {
        const { undoStack, redoStack } = get();
        if (!undoStack.length) return null;
        const prev = undoStack[undoStack.length - 1]!;
        set({
            undoStack: undoStack.slice(0, -1),
            redoStack: [...redoStack, current],
        });
        return prev;
    },

    redo: (current) => {
        const { undoStack, redoStack } = get();
        if (!redoStack.length) return null;
        const next = redoStack[redoStack.length - 1]!;
        set({
            redoStack: redoStack.slice(0, -1),
            undoStack: [...undoStack, current],
        });
        return next;
    },

    clear: () => set({ undoStack: [], redoStack: [] }),
}));
