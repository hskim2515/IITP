import { create } from 'zustand'
import { Scenario, ScenarioVersions } from "@type/Scenario";

interface ScenarioStore {
    selectedScenario: Scenario | null;
    setScenario: (scenario: Scenario) => void;
    selectedScenarioVersion: ScenarioVersions | null;
    setVersion: (version: ScenarioVersions) => void;
    resetScenario: () => void;
}

export const useScenarioStore = create<ScenarioStore>((set) => ({
    selectedScenario: null,
    selectedScenarioVersion: null,
    setScenario: (scenario) => set({ selectedScenario: scenario }),
    setVersion: (version) => set({ selectedScenarioVersion: version }),
    resetScenario: () => set({ selectedScenario: null, selectedScenarioVersion: null }),
}));