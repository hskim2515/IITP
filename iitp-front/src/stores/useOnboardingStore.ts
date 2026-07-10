import { create } from 'zustand';

type OnboardingStep = 'idle' | 'need-network' | 'need-dummy' | 'need-simulation';

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
