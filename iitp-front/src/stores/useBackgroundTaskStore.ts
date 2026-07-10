import { create } from 'zustand';

/**
 * 장기 백그라운드 작업 표시 스토어 (지도 상단 스피너).
 * 차량 경로 생성(202 폴링), 대용량 임포트 등 수십 초~분 단위 작업의 진행 단계를 노출한다.
 * key 별로 label 을 설정/해제 — 하나라도 있으면 Maps.tsx 가 스피너+문구를 표시.
 */
interface BackgroundTaskState {
    /** key → 표시 문구 (예: 'vehicle-gen' → '차량 경로 생성 중 — SQLite 업로드 (27초)') */
    tasks: Record<string, string>;
    /** label=null 이면 해당 작업 제거 */
    setTask: (key: string, label: string | null) => void;
}

export const useBackgroundTaskStore = create<BackgroundTaskState>((set) => ({
    tasks: {},
    setTask: (key, label) => set((s) => {
        const tasks = { ...s.tasks };
        if (label == null) delete tasks[key];
        else tasks[key] = label;
        return { tasks };
    }),
}));
