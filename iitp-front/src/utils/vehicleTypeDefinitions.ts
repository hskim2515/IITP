export const VEHICLE_PARAMETER_NAMES = [
    'veh_len',
    'veh_width',
    'jamgap',
    'vf',
    'reaction_time',
    'max_acc',
    'max_dec',
    'lc_param1',
    'lc_param2',
    'lc_sensitivity',
] as const;

export type VehicleParameterName = typeof VEHICLE_PARAMETER_NAMES[number];
export type VehicleDistribution = 'normal' | 'lognormal';

export interface VehicleParameterValue {
    mean: string;
    sd: string;
    min: string;
    max: string;
    dist: VehicleDistribution;
}

export interface VehicleTypeDefinition {
    canonicalName: string;
    nextsimTypeCode: string;
    vehicleId: string;
    label: string;
    description: string;
    maxPax: string;
    v2x: 'on' | 'off';
    routeSupported: boolean;
    parameters: Record<VehicleParameterName, VehicleParameterValue>;
}

export interface VehicleTypeRecord {
    id?: number;
    key?: string;
    vehicleId: string;
    name: string;
    v2x: string;
    drt: string;
    maxPax: string;
    nextsimTypeCode?: string | null;
    canonicalName?: string | null;
    platformOnly?: boolean;
    parameters?: Partial<Record<VehicleParameterName, VehicleParameterValue>>;
}

export interface VehicleTypeDetailRow {
    parameterName?: string;
    mean?: string;
    sd?: string;
    min?: string;
    max?: string;
    dist?: string;
}

export interface VehicleTypeDraft {
    id?: number;
    vehicleId: string;
    name: string;
    v2x: 'on' | 'off';
    drt: string;
    maxPax: string;
    nextsimTypeCode: string;
    canonicalName?: string;
    platformOnly: boolean;
    routeSupported: boolean;
    parameters: Record<VehicleParameterName, VehicleParameterValue>;
}

export interface VehicleTypeValidationError {
    field: string;
    message: string;
}

const p = (
    mean: string,
    sd: string,
    min: string,
    max: string,
    dist: VehicleDistribution = 'normal',
): VehicleParameterValue => ({ mean, sd, min, max, dist });

const laneChangeDefaults = {
    lc_param1: p('0.025', '0.02', '0.01', '0.04'),
    lc_param2: p('0.055', '0.02', '0.03', '0.08'),
    lc_sensitivity: p('0.0033', '2.5', '0.001', '0.1', 'lognormal'),
} satisfies Pick<Record<VehicleParameterName, VehicleParameterValue>, 'lc_param1' | 'lc_param2' | 'lc_sensitivity'>;

export const NEXTSIM_VEHICLE_TYPES: VehicleTypeDefinition[] = [
    {
        canonicalName: 'NormalVeh',
        nextsimTypeCode: 'NV',
        vehicleId: 'NV',
        label: '일반 차량',
        description: '일반 운전자가 운전하는 승용 차량',
        maxPax: '0',
        v2x: 'off',
        routeSupported: true,
        parameters: {
            veh_len: p('5.0', '0.5', '4.5', '5.5'),
            veh_width: p('1.9', '0.2', '1.8', '2.1'),
            jamgap: p('2.5', '1.0', '2.0', '4.5'),
            vf: p('50.0', '10.0', '45.0', '60.0'),
            reaction_time: p('0.8', '2', '0.5', '3.0', 'lognormal'),
            max_acc: p('4.5', '1.1', '4.0', '5.0'),
            max_dec: p('5.0', '1.2', '4.5', '5.5'),
            ...laneChangeDefaults,
        },
    },
    {
        canonicalName: 'AutonomousVeh',
        nextsimTypeCode: 'AV',
        vehicleId: 'AV',
        label: '자율주행 차량',
        description: '자율주행 제어 특성을 사용하는 승용 차량',
        maxPax: '15',
        v2x: 'off',
        routeSupported: true,
        parameters: {
            veh_len: p('5.0', '0.5', '4.5', '5.5'),
            veh_width: p('1.9', '0.2', '1.8', '2.1'),
            jamgap: p('2.0', '0.01', '1.0', '3.5'),
            vf: p('110.0', '0.01', '90.0', '125.0'),
            reaction_time: p('1.7', '0.01', '1.1', '3.5'),
            max_acc: p('4.8', '0.01', '4.5', '5.5'),
            max_dec: p('5.6', '0.01', '4.5', '6.5'),
            ...laneChangeDefaults,
        },
    },
    {
        canonicalName: 'Truck',
        nextsimTypeCode: 'TRUCK',
        vehicleId: 'TRUCK',
        label: '트럭',
        description: '화물 운송용 대형 차량',
        maxPax: '1',
        v2x: 'off',
        routeSupported: true,
        parameters: {
            veh_len: p('8.0', '0.5', '6.0', '10.0'),
            veh_width: p('2.2', '0.3', '2.0', '2.5'),
            jamgap: p('4.0', '0.5', '2.0', '6.0', 'lognormal'),
            vf: p('85.0', '10.0', '70.0', '100.0'),
            reaction_time: p('2.4', '0.5', '1.5', '3.5', 'lognormal'),
            max_acc: p('1.0', '0.5', '0.6', '1.8'),
            max_dec: p('5.0', '0.5', '4.0', '6.0'),
            ...laneChangeDefaults,
        },
    },
    {
        canonicalName: 'NormalBus',
        nextsimTypeCode: 'NB',
        vehicleId: 'NB',
        label: '일반 버스',
        description: '일반 운전자가 운전하는 대중교통 버스',
        maxPax: '30',
        v2x: 'off',
        routeSupported: true,
        parameters: {
            veh_len: p('11.0', '0', '11.0', '11.0'),
            veh_width: p('2.3', '0.3', '2.1', '2.5'),
            jamgap: p('2.0', '0.5', '1.5', '2.5', 'lognormal'),
            vf: p('45.0', '10.0', '40.0', '50.0'),
            reaction_time: p('2.4', '0.2', '1.5', '3.5', 'lognormal'),
            max_acc: p('3.0', '0.5', '2.0', '4.0'),
            max_dec: p('3.3', '0.5', '3.0', '3.6'),
            ...laneChangeDefaults,
        },
    },
    {
        canonicalName: 'AutonomousBus',
        nextsimTypeCode: 'AB',
        vehicleId: 'AB',
        label: '자율주행 버스',
        description: '자율주행 제어 특성을 사용하는 대중교통 버스',
        maxPax: '30',
        v2x: 'off',
        routeSupported: true,
        parameters: {
            veh_len: p('11.0', '0', '11.0', '11.0'),
            veh_width: p('2.3', '0.3', '2.1', '2.5'),
            jamgap: p('4.0', '0.01', '2.0', '6.0', 'lognormal'),
            vf: p('70.0', '0.01', '50.0', '80.0'),
            reaction_time: p('2.4', '0.01', '1.5', '3.5', 'lognormal'),
            max_acc: p('1.0', '0.01', '0.8', '1.8'),
            max_dec: p('5.0', '0.01', '4.0', '6.0'),
            ...laneChangeDefaults,
        },
    },
    {
        canonicalName: 'TRT',
        nextsimTypeCode: 'TRT',
        vehicleId: 'TRT',
        label: 'TRT',
        description: 'NextSim 필수 유형이며 현재 플랫폼에서는 경로 생성이 지원되지 않습니다.',
        maxPax: '91',
        v2x: 'off',
        routeSupported: false,
        parameters: {
            veh_len: p('10.0', '0', '10.0', '10.0'),
            veh_width: p('2.75', '0', '2.75', '2.75'),
            jamgap: p('3.5', '0.01', '2.5', '5.0', 'lognormal'),
            vf: p('75.0', '0', '75.0', '75.0'),
            reaction_time: p('2.0', '0.01', '1.0', '3.0', 'lognormal'),
            max_acc: p('2.5', '0.1', '2.0', '3.0'),
            max_dec: p('2.0', '0', '2.0', '2.0'),
            ...laneChangeDefaults,
        },
    },
];

export const VEHICLE_PARAMETER_META: Record<VehicleParameterName, { label: string; unit: string; advanced?: boolean }> = {
    veh_len: { label: '차량 길이', unit: 'm' },
    veh_width: { label: '차량 폭', unit: 'm' },
    jamgap: { label: '최소 차간거리', unit: 'm' },
    vf: { label: '희망 주행속도', unit: 'km/h' },
    reaction_time: { label: '반응시간', unit: '초' },
    max_acc: { label: '최대 가속도', unit: 'm/s²' },
    max_dec: { label: '최대 감속도', unit: 'm/s²' },
    lc_param1: { label: '차로변경 파라미터 1', unit: '', advanced: true },
    lc_param2: { label: '차로변경 파라미터 2', unit: '', advanced: true },
    lc_sensitivity: { label: '차로변경 민감도', unit: '', advanced: true },
};

const cloneParameters = (
    parameters: Record<VehicleParameterName, VehicleParameterValue>,
): Record<VehicleParameterName, VehicleParameterValue> => Object.fromEntries(
    VEHICLE_PARAMETER_NAMES.map(name => [name, { ...parameters[name] }]),
) as Record<VehicleParameterName, VehicleParameterValue>;

export const normalizeNextsimCodes = (value?: string | null): string[] => (
    value ?? ''
).split(',').map(code => code.trim().toUpperCase()).filter(Boolean);

export const findDefinitionForRecord = (record: VehicleTypeRecord): VehicleTypeDefinition | undefined => {
    const codes = normalizeNextsimCodes(record.nextsimTypeCode);
    return NEXTSIM_VEHICLE_TYPES.find(definition => codes.includes(definition.nextsimTypeCode));
};

export const createDefaultVehicleTypeDraft = (definition: VehicleTypeDefinition): VehicleTypeDraft => ({
    vehicleId: definition.vehicleId,
    name: definition.label,
    v2x: definition.v2x,
    drt: '0',
    maxPax: definition.maxPax,
    nextsimTypeCode: definition.nextsimTypeCode,
    canonicalName: definition.canonicalName,
    platformOnly: false,
    routeSupported: definition.routeSupported,
    parameters: cloneParameters(definition.parameters),
});

export const createPlatformOnlyDraft = (record: VehicleTypeRecord): VehicleTypeDraft => {
    const fallback = NEXTSIM_VEHICLE_TYPES[0].parameters;
    return {
        ...record,
        v2x: record.v2x === 'on' ? 'on' : 'off',
        drt: record.drt ?? '0',
        maxPax: String(record.maxPax ?? '0'),
        nextsimTypeCode: record.nextsimTypeCode ?? '',
        platformOnly: true,
        routeSupported: false,
        parameters: cloneParameters(fallback),
    };
};

export const mergeVehicleTypeDetail = (
    record: VehicleTypeRecord,
    detailRows: VehicleTypeDetailRow[],
    definition?: VehicleTypeDefinition,
): VehicleTypeDraft => {
    const draft = definition
        ? { ...createDefaultVehicleTypeDraft(definition), id: record.id }
        : createPlatformOnlyDraft(record);

    draft.vehicleId = record.vehicleId;
    draft.name = record.name;
    draft.v2x = record.v2x === 'on' ? 'on' : 'off';
    draft.drt = record.drt ?? '0';
    draft.maxPax = String(record.maxPax ?? draft.maxPax);
    draft.nextsimTypeCode = record.nextsimTypeCode ?? draft.nextsimTypeCode;

    detailRows.forEach(row => {
        if (!VEHICLE_PARAMETER_NAMES.includes(row.parameterName as VehicleParameterName)) return;
        const name = row.parameterName as VehicleParameterName;
        draft.parameters[name] = {
            mean: String(row.mean ?? draft.parameters[name].mean),
            sd: String(row.sd ?? draft.parameters[name].sd),
            min: String(row.min ?? draft.parameters[name].min),
            max: String(row.max ?? draft.parameters[name].max),
            dist: row.dist?.toLowerCase() === 'lognormal' ? 'lognormal' : 'normal',
        };
    });
    return draft;
};

export const toVehicleTypePayload = (draft: VehicleTypeDraft): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
        vehicleId: draft.vehicleId,
        name: draft.name,
        v2x: draft.v2x,
        drt: draft.drt,
        maxPax: String(draft.maxPax),
        nextsimTypeCode: draft.platformOnly ? '' : draft.nextsimTypeCode,
    };
    if (!draft.platformOnly) {
        VEHICLE_PARAMETER_NAMES.forEach(name => {
            payload[name] = { ...draft.parameters[name] };
        });
    }
    return payload;
};

export const validateVehicleTypeDraft = (draft: VehicleTypeDraft): VehicleTypeValidationError[] => {
    const errors: VehicleTypeValidationError[] = [];
    if (!draft.vehicleId.trim()) errors.push({ field: 'vehicleId', message: '차종 ID가 필요합니다.' });
    if (!draft.name.trim()) errors.push({ field: 'name', message: '이름이 필요합니다.' });
    if (!draft.platformOnly && !draft.nextsimTypeCode) {
        errors.push({ field: 'nextsimTypeCode', message: 'NextSim 유형 코드가 필요합니다.' });
    }
    if (!Number.isFinite(Number(draft.maxPax)) || Number(draft.maxPax) < 0) {
        errors.push({ field: 'maxPax', message: '최대 탑승 인원은 0 이상의 숫자여야 합니다.' });
    }

    if (!draft.platformOnly) {
        VEHICLE_PARAMETER_NAMES.forEach(name => {
            const value = draft.parameters[name];
            const min = Number(value.min);
            const mean = Number(value.mean);
            const max = Number(value.max);
            const sd = Number(value.sd);
            if (![min, mean, max, sd].every(Number.isFinite)) {
                errors.push({ field: name, message: `${VEHICLE_PARAMETER_META[name].label} 값을 모두 입력해주세요.` });
                return;
            }
            if (min > mean || mean > max) {
                errors.push({ field: name, message: `${VEHICLE_PARAMETER_META[name].label}은 최소 ≤ 평균 ≤ 최대여야 합니다.` });
            }
            if (sd < 0) {
                errors.push({ field: name, message: `${VEHICLE_PARAMETER_META[name].label}의 표준편차는 0 이상이어야 합니다.` });
            }
        });
    }
    return errors;
};
