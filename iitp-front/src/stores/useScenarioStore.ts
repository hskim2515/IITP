import { create } from 'zustand'

interface ScenarioStore {
    selectedScenario: string | null;
    setScenario: (scenario: string) => void;
    selectedScenarioVersion: string | null;
    setVersion: (version: number) => void;
    resetScenario: () => void;
}

export const useScenarioStore = create<ScenarioStore>((set) => ({
    selectedScenario: null,
    selectedScenarioVersion: null,
    setScenario: (scenario) => set({ selectedScenario: scenario }),
    setVersion: (version) => set({ selectedScenarioVersion: version }),
    resetScenario: () => set({ selectedScenario: null }),
}));
