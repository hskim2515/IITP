import {
    CreateFieldOptionRequest,
    CreateFieldRequest,
    LayerSchemaFieldResponse,
    LayerSchemaOptionResponse,
    LayerSchemaResponse,
    SchemaDefinition,
    SchemaFieldsRequest,
    UpdateFieldOption,
    UpdateFieldRequest
} from "@type/openapi.gen";
import { GenerateTemplateOptions, Template } from "@type/Schema";

/**
 * 스키마 내에서 ID로 특정 필드 탐색
 */
export function findFieldById(
    schema: SchemaDefinition,
    id: LayerSchemaFieldResponse["id"]
): LayerSchemaFieldResponse | null {
    if (!schema?.fields || id === undefined) return null;
    return schema.fields.find((f) => f.id === id) ?? null;
}

/**
 *
 */
function isEffectivelyDeleted(option: {value?: any; deleted?: boolean}): boolean {
    if (option.deleted === true) return true;
    const v = option.value;
    if (v === null || v === undefined) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    return false;
}


/**
 * 공통 ID를 가진 옵션 중 값이 변경된 항목을 수집
 */
function collectUpdatedOptionsByPresence(
    originField: LayerSchemaFieldResponse,
    currentField: LayerSchemaFieldResponse
): UpdateFieldOption[] {
    if (!originField || !currentField) return [];

    const originOptionsById = (originField.options ?? []).reduce<Map<string, string>>(
        (map, option) => {
            if (option.id !== undefined && option.value !== undefined) {
                map.set(String(option.id), option.value);
            }
            return map;
        }, new Map());

    return (currentField.options ?? []).reduce<UpdateFieldOption[]>(
        (updates, currentOption) => {
            const id = currentOption.id;
            const stringId = id !== undefined ? String(id) : undefined;

            if (
                stringId &&
                originOptionsById.has(stringId) &&
                !isEffectivelyDeleted(currentOption) &&
                originOptionsById.get(stringId) !== currentOption.value
            ) {
                const updated: UpdateFieldOption = {id, value: currentOption.value}
                updates.push(updated);
            }
            return updates;
        }, []);
}

/**
 * 새로 추가된 옵션을 수집
 */
function collectCreatedOptionsByPresence(
    originField: LayerSchemaFieldResponse,
    currentField: LayerSchemaFieldResponse
): CreateFieldOptionRequest[] {
    if (!currentField) return [];

    const originIds = (originField?.options ?? []).reduce<Set<string>>(
        (set, option) => {
            if (option.id !== undefined) {
                set.add(String(option.id));
            }
            return set;
        }, new Set());

    return (currentField.options ?? []).reduce<CreateFieldOptionRequest[]>(
        (creates, option) => {
            const isNew = option.id === undefined || !originIds.has(String(option.id));

            if (isNew && option.value !== undefined && !isEffectivelyDeleted(option)) {
                const created: CreateFieldOptionRequest = {value: option.value}
                creates.push(created);
            }
            return creates;
        }, []);
}

/**
 * 원본에서 삭제된 옵션의 ID를 수집
 */
function collectDeletedOptionsByPresence(
    originField: LayerSchemaFieldResponse,
    currentField: LayerSchemaFieldResponse
): number[] | [] {
    if (!originField || !currentField) return [];

    const editedOptionsById = (currentField.options ?? []).reduce<Map<string, LayerSchemaOptionResponse>>((map, option) => {
        if (option.id !== undefined) {
            map.set(String(option.id), option);
        }
        return map;
    }, new Map());

    return (originField.options ?? []).reduce<number[]>((deletes, originOption) => {
        const id = originOption.id;
        const stringId = id !== undefined ? String(id) : undefined;

        if (stringId) {
            const editedOption = editedOptionsById.get(stringId);
            if (!editedOption || isEffectivelyDeleted(editedOption)) {
                deletes.push(id!);
            }
        }
        return deletes;
    }, []);
}

/**
 * 두 필드의 기본 속성 변경 사항만 추출
 */
function buildBaseChanges(baseField: LayerSchemaFieldResponse, editedField: LayerSchemaFieldResponse): Partial<UpdateFieldRequest> {
    const changes: Partial<UpdateFieldRequest> = {};
    if (baseField.name !== editedField.name) changes.name = editedField.name;
    if (baseField.nullable !== editedField.nullable) changes.nullable = editedField.nullable;
    if (baseField.defaultValue !== editedField.defaultValue) changes.defaultValue = editedField.defaultValue;
    if (baseField.readOnly !== editedField.readOnly) changes.readOnly = editedField.readOnly;
    if (baseField.status !== editedField.status) changes.status = editedField.status;
    return changes;
}

/**
 * 두 필드의 옵션(생성/수정/삭제) 변경 사항을 추출
 */
function collectOptionChanges(baseField: LayerSchemaFieldResponse, editedField: LayerSchemaFieldResponse) {
    const optionsToCreate = collectCreatedOptionsByPresence(baseField, editedField);
    const options = collectUpdatedOptionsByPresence(baseField, editedField);
    const optionIdsToDelete = collectDeletedOptionsByPresence(baseField, editedField);

    return {
        ...(optionsToCreate.length > 0 && {optionsToCreate}),
        ...(options.length > 0 && {options}),
        ...(optionIdsToDelete.length > 0 && {optionIdsToDelete}),
    };
}

/**
 * 두 스키마(baseline, edited)를 비교하여 생성, 수정, 삭제될 필드 정보를 담은 요청 객체를 생성합니다.
 * @param baseline 비교 기준이 되는 원본 스키마
 * @param edited 사용자가 수정한 새로운 스키마
 * @returns 변경 사항이 있을 경우 SchemaFieldsRequest 객체, 없으면 null
 */
export function buildSchemaFieldsRequest(
    baseline: SchemaDefinition,
    edited: SchemaDefinition
): SchemaFieldsRequest | null {
    const fieldIdsToDelete = (baseline.fields ?? [])
        .filter((f): f is { id: number } => f.id !== undefined && !findFieldById(edited, f.id))
        .map((f) => f.id);

    const fieldsToCreate = (edited.fields ?? [])
        .filter((f) => f.id === undefined || !findFieldById(baseline, f.id))
        .map((f): CreateFieldRequest => ({
            name: f.name,
            nullable: f.nullable,
            defaultValue: f.defaultValue,
            readOnly: f.readOnly,
            status: f.status,
            inputType: f.inputType,
            ...(f.inputType === 'select' && {
                options: (f.options ?? []).filter(o => o.value !== undefined).map(o => ({ value: o.value! })),
            }),
        }));

    const fieldsToUpdate = (edited.fields ?? [])
        .filter((ef) => ef.id !== undefined && !!findFieldById(baseline, ef.id))
        .map((editedField): UpdateFieldRequest | null => {
            const baseField = findFieldById(baseline, editedField.id!)!;
            const baseChanges = buildBaseChanges(baseField, editedField);
            const optionChanges = collectOptionChanges(baseField, editedField);
            const inputTypeChanged = baseField.inputType !== editedField.inputType;

            if (!inputTypeChanged && Object.keys(baseChanges).length === 0 && Object.keys(optionChanges).length === 0) {
                return null;
            }

            return {
                id: editedField.id!,
                ...baseChanges,
                ...(inputTypeChanged && { inputType: editedField.inputType }),
                ...optionChanges,
            };
        })
        .filter((req): req is UpdateFieldRequest => req !== null);

    if (fieldsToCreate.length === 0 && fieldsToUpdate.length === 0 && fieldIdsToDelete.length === 0) {
        return null;
    }

    return {
        id: edited.id,
        fieldsToCreate: fieldsToCreate.length ? fieldsToCreate : undefined,
        fieldsToUpdate: fieldsToUpdate.length ? fieldsToUpdate : undefined,
        fieldIdsToDelete: fieldIdsToDelete.length ? fieldIdsToDelete : undefined,
    };
}

/**
 * 두 레이어 스키마(baselineLayer, editedLayer)를 받아 내부의 모든 스키마에 대한 변경 요청 목록을 생성합니다.
 * @param baselineLayer 비교 기준 원본 레이어
 * @param editedLayer 사용자 수정 레이어
 * @returns 모든 스키마 변경 요청을 담은 배열
 */
export function buildLayerSchemaRequests(
    baselineLayer: LayerSchemaResponse,
    editedLayer: LayerSchemaResponse
): SchemaFieldsRequest[] {
    const baselineSchemasById = (baselineLayer.definition ?? []).reduce<Map<number, SchemaDefinition>>((map, schema) => {
        if (schema.id !== undefined) {
            map.set(schema.id, schema);
        }
        return map;
    }, new Map());

    return (editedLayer.definition ?? []).reduce<SchemaFieldsRequest[]>((requests, currentSchema) => {
        if (currentSchema.id !== undefined) {
            const baselineSchema = baselineSchemasById.get(currentSchema.id) ?? { ...currentSchema, fields: [] };
            const requestDto = buildSchemaFieldsRequest(baselineSchema, currentSchema);
            if (requestDto) {
                requests.push(requestDto);
            }
        }
        return requests;
    }, []);
}

/**
 * 스키마 정의를 바탕으로 데이터 입력을 위한 기본 템플릿 객체를 생성합니다.
 * @param schema 템플릿을 생성할 스키마 정의
 * @param options 추가 속성, 제외할 필드 등을 포함하는 옵션
 * @returns 생성된 템플릿 객체
 */
export function generateTemplate(
    schema: SchemaDefinition | null,
    options: GenerateTemplateOptions = {}
): Template | undefined {
    if (schema == null) return;

    const { additionalProps = {}, exclude = [] } = options;

    const baseTemplate = (schema.fields ?? []).reduce<Template>((acc, field) => {
        if (field.name && !exclude.includes(field.name)) {
            acc[field.name] = field.defaultValue ?? undefined;
        }
        return acc;
    }, {});

    return {
        ...baseTemplate,
        ...additionalProps,
    };
}