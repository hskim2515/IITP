import { useState, useRef, useCallback } from 'react';

export interface ImportStep {
    label: string;
    weight: number; // 전체 대비 예상 비중 (합계 100)
}

// 실측 기반 가중치 (시설물 Overpass 쿼리가 전체의 ~75%)
export const OSM_STEPS: ImportStep[] = [
    { label: 'OSM 데이터 조회 중...', weight:  5 },
    { label: 'netconvert 실행 중...', weight:  8 },
    { label: '네트워크 변환 중...',   weight:  4 },
    { label: '시설물 데이터 조회 중...', weight: 78 },
    { label: '시설물 변환 중...',     weight:  5 },
];

export interface ProgressState {
    running: boolean;
    percent: number;
    stepLabel: string;
    elapsed: number; // 초
}

export function useImportProgress(steps: ImportStep[] = OSM_STEPS) {
    const [state, setState] = useState<ProgressState>({
        running: false, percent: 0, stepLabel: '', elapsed: 0,
    });
    const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
    const startRef  = useRef<number>(0);
    const stepIdxRef = useRef<number>(0);
    const stepStartPctRef = useRef<number>(0);

    const start = useCallback(() => {
        stepIdxRef.current      = 0;
        stepStartPctRef.current = 0;
        startRef.current        = Date.now();

        // 총 예상 시간: 45초 기준 (Overpass 포함 실측 평균)
        const totalMs = 45000;

        setState({ running: true, percent: 0, stepLabel: steps[0]?.label ?? '', elapsed: 0 });

        timerRef.current = setInterval(() => {
            const elapsed = (Date.now() - startRef.current) / 1000;
            const rawPct  = Math.min(((Date.now() - startRef.current) / totalMs) * 100, 92);

            // 현재 step 결정
            let cumWeight = 0;
            let stepIdx   = 0;
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                if (!step) continue;
                cumWeight += step.weight;
                if (rawPct < cumWeight) { stepIdx = i; break; }
                stepIdx = i;
            }

            setState({
                running:   true,
                percent:   Math.round(rawPct),
                stepLabel: (stepIdx < steps.length ? steps[stepIdx]?.label : undefined) ?? '',
                elapsed:   Math.round(elapsed),
            });
        }, 200);
    }, [steps]);

    const finish = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        setState(prev => ({ ...prev, running: false, percent: 100, stepLabel: '완료' }));
        setTimeout(() => setState({ running: false, percent: 0, stepLabel: '', elapsed: 0 }), 1500);
    }, []);

    const reset = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        setState({ running: false, percent: 0, stepLabel: '', elapsed: 0 });
    }, []);

    return { progress: state, start, finish, reset };
}
