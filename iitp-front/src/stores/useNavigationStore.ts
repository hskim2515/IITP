import { create } from "zustand";

export type DrillFrame = {
  levelName: string;
  rows: any[];
  parentRecord?: any;
  parentGuid?: string;
  breadLabel: string;
  hasChildren: boolean;
};

type NavigationState = {
  stack: DrillFrame[];
  push: (frame: DrillFrame) => void;
  pop: () => void;
  goTo: (index: number) => void;
  clear: () => void;
  init: (rootFrame: DrillFrame) => void;
  updateRootRows: (rows: any[]) => void;
  rebuildStack: (rootRows: any[]) => void;
  navigateByPath: (
      targetGuid: string,
      rootFrame: DrillFrame,
      childrenFieldsFinder: (levelName: string) => string[]
  ) => void;
};

export const useNavigationStore = create<NavigationState>((set) => ({
  stack: [],

  push: (frame) => set((s) => ({ stack: [...s.stack, frame] })),

  pop: () => set((s) => ({
    stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack,
  })),

  goTo: (index) => set((s) => ({
    stack: s.stack.slice(0, index + 1),
  })),

  clear: () => set({ stack: [] }),

  init: (rootFrame) => set({ stack: [rootFrame] }),

  updateRootRows: (rows) => set((s) => {
    if (s.stack.length === 0) return s;
    const [root, ...rest] = s.stack;
    return { stack: [{ ...root, rows }, ...rest] };
  }),

  rebuildStack: (rootRows) => set((s) => {
    if (s.stack.length === 0) return s;

    const newStack: DrillFrame[] = [];
    let currentRows = rootRows;

    for (let i = 0; i < s.stack.length; i++) {
      const frame = s.stack[i];
      if (i === 0) {
        newStack.push({ ...frame, rows: rootRows });
        currentRows = rootRows;
      } else {
        const parentRecord = currentRows.find((r: any) => r.__guid === frame.parentGuid);
        const newRows = parentRecord && Array.isArray(parentRecord[frame.levelName])
          ? parentRecord[frame.levelName]
          : frame.rows;
        newStack.push({ ...frame, rows: newRows, parentRecord: parentRecord ?? frame.parentRecord });
        currentRows = newRows;
      }
    }

    return { stack: newStack };
  }),

  navigateByPath: (targetGuid, rootFrame, childrenFieldsFinder) => {
    set((state) => {
      const actualRoot = state.stack[0] ?? rootFrame;
      const newStack: DrillFrame[] = [actualRoot];
      let currentRows = actualRoot.rows;
      let currentLevel = actualRoot.levelName;

      let safetyCounter = 0;

      while (safetyCounter < 10) {
        const match = currentRows.find(row =>
            targetGuid === row.__guid || targetGuid.startsWith(`${row.__guid}.`)
        );

        if (!match || targetGuid === match.__guid) break;

        const childFields = childrenFieldsFinder(currentLevel);
        const nextField = childFields.find(f =>
                Array.isArray(match[f]) && match[f].some((c: any) =>
                    targetGuid === c.__guid || targetGuid.startsWith(`${c.__guid}.`)
                )
        );

        if (nextField) {
          const idValue = match.id ?? match.__guid?.split('-').pop() ?? "?";
          const grandChildFields = childrenFieldsFinder(nextField);
          const nextFrame: DrillFrame = {
            levelName: nextField,
            rows: match[nextField],
            parentRecord: match,
            parentGuid: match.__guid,
            breadLabel: `${currentLevel} #${idValue}`,
            hasChildren: grandChildFields.length > 0,
          };
          newStack.push(nextFrame);

          currentRows = match[nextField];
          currentLevel = nextField;
          safetyCounter++;
        } else {
          break;
        }
      }

      return { stack: newStack };
    });
  }
}));

export const useCurrentFrame = (): DrillFrame | undefined =>
    useNavigationStore((s) => s.stack[s.stack.length - 1]);

export const useCanGoBack = (): boolean =>
    useNavigationStore((s) => s.stack.length > 1);
