import { create } from 'zustand';

type OnboardingStep = 'idle' | 'need-network' | 'need-dummy';

interface OnboardingState {
    step: OnboardingStep;
    setStep: (step: OnboardingStep) => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
    step: 'idle',
    setStep: (step) => set({ step }),
}));
