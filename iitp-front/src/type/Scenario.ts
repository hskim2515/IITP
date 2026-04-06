export interface Scenario {
    id: number,
    key: string,
    longitude: number,
    latitude: number,
    label: string,
    description: string
    versions: ScenarioVersions[]
}

export interface ScenarioVersions {
    id: number,
    key: string,
    label: string,
    dataPath: string | null,
    insertDate: string,
    modifyDate: string
}