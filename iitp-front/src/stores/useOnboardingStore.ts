import { create } from 'zustand';

// 'need-dummy'(신호+노면표시 더미 생성 요구) 단계는 제거됨 — 이제 필요할 때
// utils/dummyGeneration.runAutoDummyGeneration() 이 자동으로 생성한다.
type OnboardingStep = 'idle' | 'need-network' | 'need-simulation';

interface OnboardingState {
    step: OnboardingStep;
    missingSignal: boolean;
    missingVehicle: boolean;
    setStep: (step: OnboardingStep) => void;
    setNeedSimulation: (missingSignal: boolean, missingVehicle: boolean) => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
    step: 'idle',
    missingSignal: true,
    missingVehicle: true,
    setStep: (step) => set({ step }),
    setNeedSimulation: (missingSignal, missingVehicle) =>
        set({ step: 'need-simulation', missingSignal, missingVehicle }),
}));
