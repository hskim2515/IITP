import type { DemandEntry, VehicleMix } from '@type/OdMatrix';

export interface OdVehicleTypeDefinition {
    id: string;
    label: string;
    description: string;
    color: string;
    nextSimTarget: 'avodMatrix' | 'nvodMatrix';
}

/** NextSim 입력 매핑이 확인된 유형만 노출한다. 새 유형은 이 목록과 XML encoder를 함께 확장한다. */
export const OD_VEHICLE_TYPES: readonly OdVehicleTypeDefinition[] = [
    {
        id: 'NV',
        label: '일반 차량',
        description: '운전자 주행 차량',
        color: '#4f8cff',
        nextSimTarget: 'nvodMatrix',
    },
    {
        id: 'AV',
        label: '자율주행 차량',
        description: '자율주행 차량',
        color: '#9b7bff',
        nextSimTarget: 'avodMatrix',
    },
];

const demandKey = (demand: Pick<DemandEntry, 'source' | 'sink'>) =>
    `${demand.source}||${demand.sink}`;

const normalizeFlow = (flow: number) =>
    Number.isFinite(flow) ? Math.max(0, Math.round(flow)) : 0;

const clampPercent = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
};

/** 한 유형을 수정하면 나머지 유형에 기존 비중대로 잔여 비율을 분배해 합계를 100으로 유지한다. */
export function rebalanceVehicleMix(
    mix: VehicleMix,
    changedId: string,
    value: number,
    definitions: readonly OdVehicleTypeDefinition[] = OD_VEHICLE_TYPES,
): VehicleMix {
    const ids = definitions.map(definition => definition.id);
    if (!ids.includes(changedId)) return mix;

    const changedValue = clampPercent(value);
    const otherIds = ids.filter(id => id !== changedId);
    if (otherIds.length === 0) return { [changedId]: 100 };

    const remainingTotal = 100 - changedValue;
    const previousOtherTotal = otherIds.reduce((sum, id) => sum + (mix[id] ?? 0), 0);
    const allocations = otherIds.map((id, index) => {
        const raw = previousOtherTotal > 0
            ? remainingTotal * ((mix[id] ?? 0) / previousOtherTotal)
            : remainingTotal / otherIds.length;
        return { id, index, value: Math.floor(raw), remainder: raw - Math.floor(raw) };
    });

    let undistributed = remainingTotal - allocations.reduce((sum, item) => sum + item.value, 0);
    [...allocations]
        .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
        .forEach(item => {
            if (undistributed <= 0) return;
            item.value += 1;
            undistributed -= 1;
        });

    return allocations.reduce<VehicleMix>(
        (result, item) => ({ ...result, [item.id]: item.value }),
        { [changedId]: changedValue },
    );
}

/** AV/NV 목록을 사용자가 편집할 하나의 총수요 목록으로 합친다. */
export function mergeVehicleDemands(
    nvDemands: DemandEntry[],
    avDemands: DemandEntry[],
): DemandEntry[] {
    const merged = new Map<string, DemandEntry>();
    for (const demand of [...nvDemands, ...avDemands]) {
        if (!demand.source || !demand.sink) continue;
        const key = demandKey(demand);
        const existing = merged.get(key);
        merged.set(key, {
            source: demand.source,
            sink: demand.sink,
            flow: (existing?.flow ?? 0) + normalizeFlow(demand.flow),
            dist: existing?.dist || demand.dist || '',
        });
    }
    return [...merged.values()].filter(demand => demand.flow > 0);
}

/** 기존 XML의 flow 합계로 시간대 차량 구성비를 복원한다. */
export function calculateVehicleMix(
    nvDemands: DemandEntry[],
    avDemands: DemandEntry[],
): VehicleMix {
    const nvTotal = nvDemands.reduce((sum, demand) => sum + normalizeFlow(demand.flow), 0);
    const avTotal = avDemands.reduce((sum, demand) => sum + normalizeFlow(demand.flow), 0);
    const total = nvTotal + avTotal;
    const avPercent = total === 0 ? 0 : clampPercent((avTotal / total) * 100);
    return { NV: 100 - avPercent, AV: avPercent };
}

/**
 * 총수요를 현재 NextSim이 지원하는 AV/NV 입력으로 분할한다.
 * 최대 나머지 방식으로 시간대 합계의 목표 비율을 맞추며 각 OD의 총 flow는 보존한다.
 */
export function splitNextSimVehicleDemands(
    demands: DemandEntry[],
    vehicleMix: VehicleMix,
): { nvDemands: DemandEntry[]; avDemands: DemandEntry[] } {
    const ratio = clampPercent(vehicleMix.AV ?? 0) / 100;
    const normalized = demands
        .filter(demand => demand.source && demand.sink)
        .map((demand, index) => {
            const total = normalizeFlow(demand.flow);
            const rawAv = total * ratio;
            return {
                ...demand,
                index,
                total,
                avFlow: Math.floor(rawAv),
                remainder: rawAv - Math.floor(rawAv),
            };
        })
        .filter(demand => demand.total > 0);

    const totalFlow = normalized.reduce((sum, demand) => sum + demand.total, 0);
    let remaining = Math.round(totalFlow * ratio)
        - normalized.reduce((sum, demand) => sum + demand.avFlow, 0);

    [...normalized]
        .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
        .forEach(demand => {
            if (remaining <= 0 || demand.avFlow >= demand.total) return;
            demand.avFlow += 1;
            remaining -= 1;
        });

    const toDemand = (demand: typeof normalized[number], flow: number): DemandEntry => ({
        source: demand.source,
        sink: demand.sink,
        flow,
        dist: demand.dist ?? '',
    });

    return {
        avDemands: normalized
            .filter(demand => demand.avFlow > 0)
            .map(demand => toDemand(demand, demand.avFlow)),
        nvDemands: normalized
            .filter(demand => demand.total - demand.avFlow > 0)
            .map(demand => toDemand(demand, demand.total - demand.avFlow)),
    };
}
