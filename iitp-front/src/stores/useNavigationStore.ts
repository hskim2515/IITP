import { create } from "zustand";

/**
 * 드릴다운 네비게이션 스택의 각 프레임
 */
export type DrillFrame = {
  /** 현재 레벨 이름 (schema structure의 name과 동일) — e.g. "links" | "lanes" | "cells" */
  levelName: string;

  /** 현재 그리드에 표시할 행 데이터 */
  rows: any[];

  /** 부모 레코드 (이 레벨로 드릴다운하게 만든 레코드) */
  parentRecord?: any;

  /** 새 레코드 추가 시 부모 guid */
  parentGuid?: string;

  /** 브레드크럼에 표시할 라벨 — e.g. "links" | "lane #2" */
  breadLabel: string;

  /**
   * 이 레벨이 중첩 구조를 가지는지 여부.
   * - true  → childrenStructure가 존재, 행 클릭 시 드릴다운 가능
   * - false → flat 데이터, 행 클릭은 선택만 (드릴다운 없음)
   *
   * SchemaStructure의 children 유무로 결정되며,
   * DrilldownGrid에서 push 시점에 계산해서 넣어줍니다.
   */
  hasChildren: boolean;
};

type NavigationState = {
  stack: DrillFrame[];

  /** 새 레벨로 드릴다운 */
  push: (frame: DrillFrame) => void;

  /** 한 단계 뒤로 */
  pop: () => void;

  /** 브레드크럼 클릭: 해당 인덱스까지 잘라냄 */
  goTo: (index: number) => void;

  /** 레이어 전환 등 전체 초기화 */
  clear: () => void;

  /**
   * 루트 프레임 설정 (레이어 최초 진입 시)
   * 기존 <JsonGrid rowData={...} levelName="links" depth={0} /> 을 대체
   */
  init: (rootFrame: DrillFrame) => void;
};

export const useNavigationStore = create<NavigationState>((set) => ({
  stack: [],

  push: (frame) =>
      set((s) => ({ stack: [...s.stack, frame] })),

  pop: () =>
      set((s) => ({
        stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack,
      })),

  goTo: (index) =>
      set((s) => ({
        stack: s.stack.slice(0, index + 1),
      })),

  clear: () => set({ stack: [] }),

  init: (rootFrame) => set({ stack: [rootFrame] }),
}));

// ─── 편의 셀렉터 ──────────────────────────────────────────────

/** 현재 프레임 (스택 마지막) */
export const useCurrentFrame = (): DrillFrame | undefined =>
    useNavigationStore((s) => s.stack[s.stack.length - 1]);

/** 뒤로가기 가능 여부 */
export const useCanGoBack = (): boolean =>
    useNavigationStore((s) => s.stack.length > 1);

/** 현재 프레임이 드릴다운 가능한지 */
export const useCurrentHasChildren = (): boolean =>
    useNavigationStore((s) => s.stack.at(-1)?.hasChildren ?? false);