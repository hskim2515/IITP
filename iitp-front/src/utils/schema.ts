import { detailedDiff } from "deep-object-diff";
import type {
    Field,
    FieldOption,
    Schema,
    LayerSchema,
    InputType,
    SchemaFieldsRequest,
    CreateFieldRequest,
    UpdateFieldRequest, GenerateTemplateOptions,
} from "@type/Schema";
import { isNil } from "lodash";

export function findFieldById(
    schema: Schema | undefined | null,
    id: Field["id"] | number | string
): Field | null {
    if (!schema || !schema.fields || schema.fields.length === 0) return null;
    return schema.fields.find((f) => f.id === id) ?? null;
}


function isEffectivelyDeleted(o: any): boolean {
    if (o && o.deleted === true) return true;
    const v = o?.value;
    if (v === null || v === undefined) return true;
    if (typeof v === "string" && v.trim() === "") return true;
    return false;
}


// 비교용 평탄화: select일 때만 options를 id→value 맵으로 치환
function normalizeFieldForCompare(f: Field) {
    const optionsMap: Record<string, string> | undefined =
        f.inputType === "select"
            ? Object.fromEntries(
                (f.options ?? [])
                    .filter((o) => !isNil(o.id))
                    .map((o) => [String(o.id), o.value])
            )
            : undefined;

    return {
        name: f.name,
        nullable: f.nullable,
        readOnly: f.readOnly,
        status: f.status,
        inputType: f.inputType,
        options: optionsMap,
    };
}

/** 공통 id의 옵션 중 value 변경만 Update 로 수집 (삭제 간주는 업데이트에서 제외) */
function collectUpdatedOptionsByPresence(originField: Field | null, currentField: Field | null) {
    if (!originField || !currentField) return [];
    const updates: { id: number; value: string }[] = [];

    const origin = new Map<string, string>(
        (originField.options ?? [])
            .filter((o) => !isNil(o.id))
            .map((o) => [String(o.id), o.value])
    );
    const current = new Map<string, any>(
        (currentField.options ?? [])
            .filter((o) => !isNil(o.id))
            .map((o) => [String(o.id), o])
    );

    for (const [id, editedOption] of current.entries()) {
        if (!origin.has(id)) continue; // 원본에 없으면 생성 후보 → 업데이트 비교 제외
        if (isEffectivelyDeleted(editedOption)) continue; // 삭제 취급은 업데이트에서 제외
        const oldVal = origin.get(id);
        const newVal = editedOption.value;
        if (oldVal !== newVal) updates.push({ id: Number(id), value: newVal });
    }
    return updates;
}

/** 원본에 없는 옵션(=생성)만 수집 (빈값/삭제간주 제외) */
function collectCreatedOptionsByPresence(originField: Field | null, currentField: Field | null) {
    if (!currentField) return [];
    const creates: { value: string }[] = [];
    const originIds = new Set<string>(
        (originField?.options ?? []).filter((o) => !isNil(o.id)).map((o) => String(o.id))
    );

    for (const option of currentField.options ?? []) {
        const isNewById = isNil(option.id) || !originIds.has(String(option.id));
        if (isNewById && !isEffectivelyDeleted(option)) {
            creates.push({ value: option.value }); // 서버 생성이므로 id 없이 value만
        }
    }
    return creates;
}

/** 원본에는 있고 편집본에는 '없거나(실제 제거)' 혹은 '삭제 간주(값 비움/플래그)'인 id를 Delete로 수집 */
function collectDeletedOptionsByPresence(originField: Field | null, currentField: Field | null) {
    if (!originField) return [];
    const deletes: number[] = [];

    const editedById = new Map<string, any>(
        (currentField?.options ?? [])
            .filter((o) => !isNil(o.id))
            .map((o) => [String(o.id), o])
    );

    for (const option of originField.options ?? []) {
        if (isNil(option.id)) continue;
        const id = String(option.id);
        const editedOption = editedById.get(id);

        // 편집본에 아예 없거나, 값이 비어서 '삭제 간주'면 삭제로 판단
        if (!editedOption || isEffectivelyDeleted(editedOption)) {
            deletes.push(Number(option.id));
        }
    }
    return deletes;
}

export function buildSchemaFieldsRequestUsingPresence(
    baseline: Schema, // 스토어의 현재 스키마(저장 기준)
    edited: Schema    // 화면에서 편집된 스키마
): SchemaFieldsRequest | null {
    // A) 필드 삭제: baseline에 있고 edited에 없는 field id
    const fieldIdsToDelete = (baseline.fields ?? [])
        .filter((f) => !findFieldById(edited, f.id))
        .map((f) => Number(f.id));

    // B) 필드 생성: edited에 있고 baseline에 없는 field
    const fieldsToCreate: CreateFieldRequest[] = (edited.fields ?? [])
        .filter((f) => !findFieldById(baseline, f.id))
        .map((f) => {
            const base =
                {
                    name: f.name,
                    nullable: f.nullable,
                    defaultValue: f.defaultValue,
                    readOnly: f.readOnly,
                    status: f.status,
                } as Omit<CreateFieldRequest, "inputType" | "options"> & { inputType?: any; options?: any };

            if (f.inputType === "select") {
                // 새 필드는 옵션 전체가 "생성"으로 취급
                return {
                    ...base,
                    inputType: "select",
                    options: (f.options ?? []).map((o) => ({ value: o.value })),
                } as CreateFieldRequest;
            }
            return {
                ...base,
                inputType: f.inputType as Exclude<InputType, "select">,
            } as CreateFieldRequest;
        });

    // C) 필드 수정: 공통 id에 대해 detailedDiff + presence로 속성/옵션 변경 수집
    const fieldsToUpdate: UpdateFieldRequest[] = [];
    const common = (edited.fields ?? []).filter((ef) => !!findFieldById(baseline, ef.id));

    for (const editedField of common) {
        const baseField = findFieldById(baseline, editedField.id)!;

        // 주로 기본 속성 변화 감지 (options는 presence로 처리)
        const difference: any = detailedDiff(normalizeFieldForCompare(baseField), normalizeFieldForCompare(editedField));

        const inputTypeChanged =
            (difference.added?.inputType ?? difference.updated?.inputType) !== undefined ||
            difference.deleted?.inputType !== undefined ||
            baseField.inputType !== editedField.inputType;

        // 기본 속성 변경 수집
        const base: Partial<UpdateFieldRequest> = {
            ...(baseField.name !== editedField.name ? { name: editedField.name } : {}),
            ...(baseField.nullable !== editedField.nullable ? { nullable: editedField.nullable } : {}),
            ...(baseField.defaultValue !== editedField.defaultValue ? { defaultValue: editedField.defaultValue } : {}),
            ...(baseField.readOnly !== editedField.readOnly ? { readOnly: editedField.readOnly } : {}),
            ...(baseField.status !== editedField.status ? { status: editedField.status } : {}),
        };

        if (inputTypeChanged) {
            if (editedField.inputType === "select") {
                // 타입이 select로 설정/변경된 경우: 옵션 생성/수정/삭제 모두 허용
                const creates = collectCreatedOptionsByPresence(baseField, editedField);
                const updates = collectUpdatedOptionsByPresence(baseField, editedField);
                const deletes = collectDeletedOptionsByPresence(baseField, editedField);

                const upd: UpdateFieldRequest = {
                    id: editedField.id!,
                    inputType: "select",
                    ...(Object.keys(base).length ? base : {}),
                    ...(updates.length > 0 ? { options: updates } : {}),
                    ...(creates.length > 0 ? { optionsToCreate: creates } : {}),
                    ...(deletes.length > 0 ? { optionIdsToDelete: deletes } : {}),
                } as UpdateFieldRequest;

                // 아무 것도 담기지 않았고 base도 없으면 스킵
                if (Object.keys(upd).length > 1) fieldsToUpdate.push(upd);
            } else {
                // select가 아닌 타입으로 변경: 옵션 관련 필드는 금지(서버에서 옵션 전부 정리)
                if (Object.keys(base).length > 0) {
                    fieldsToUpdate.push({
                        id: editedField.id!,
                        inputType: editedField.inputType as Exclude<InputType, "select">,
                        ...base,
                    } as UpdateFieldRequest);
                } else {
                    // inputType만 바뀐 경우라도 명시
                    fieldsToUpdate.push({
                        id: editedField.id!,
                        inputType: editedField.inputType as Exclude<InputType, "select">,
                    } as UpdateFieldRequest);
                }
            }
            continue;
        }

        // inputType 동일
        if (editedField.inputType === "select") {
            // 생성/수정/삭제 모두 분리해서 담음
            const creates = collectCreatedOptionsByPresence(baseField, editedField);
            const updates = collectUpdatedOptionsByPresence(baseField, editedField);
            const deletes = collectDeletedOptionsByPresence(baseField, editedField);

            if (
                Object.keys(base).length > 0 ||
                creates.length > 0 ||
                updates.length > 0 ||
                deletes.length > 0
            ) {
                const upd: UpdateFieldRequest = {
                    id: editedField.id!,
                    ...(Object.keys(base).length ? base : {}),
                    ...(updates.length > 0 ? { options: updates } : {}),
                    ...(creates.length > 0 ? { optionsToCreate: creates } : {}),
                    ...(deletes.length > 0 ? { optionIdsToDelete: deletes } : {}),
                } as UpdateFieldRequest;
                fieldsToUpdate.push(upd);
            }
        } else {
            // select가 아니고 타입 동일: 기본 속성만
            if (Object.keys(base).length > 0) {
                fieldsToUpdate.push({ id: editedField.id!, ...(base as any) } as UpdateFieldRequest);
            }
        }
    }

    const empty =
        fieldsToCreate.length === 0 &&
        fieldsToUpdate.length === 0 &&
        fieldIdsToDelete.length === 0;

    return empty
        ? null
        : {
            id: edited.id,
            fieldsToCreate: fieldsToCreate.length ? fieldsToCreate : undefined,
            fieldsToUpdate: fieldsToUpdate.length ? fieldsToUpdate : undefined,
            fieldIdsToDelete: fieldIdsToDelete.length ? fieldIdsToDelete : undefined,
        };
}

export function buildLayerSchemaRequestsUsingPresence(
    baselineLayer: LayerSchema,
    editedLayer: LayerSchema
): SchemaFieldsRequest[] {
    const bById = new Map<number, Schema>((baselineLayer.schemata ?? []).map((schema) => [schema.id, schema]));
    const out: SchemaFieldsRequest[] = [];
    for (const current of editedLayer.schemata ?? []) {
        const base = bById.get(current.id) ?? { ...current, fields: [] };
        const dto = buildSchemaFieldsRequestUsingPresence(base, current);
        if (dto) out.push(dto);
    }
    return out;
}

export function generateTemplate(
    schema: Schema | null,
    options: GenerateTemplateOptions = {}
): Record<string, any> | undefined {
    if (schema == null) return;

    const { additionalProps = {}, exclude = [] } = options;

    const baseTemplate = schema.fields.reduce((acc, field) => {
        if (!exclude.includes(field.name)) {
            acc[field.name] = (field.defaultValue !== undefined && field.defaultValue !== null)
                ? field.defaultValue
                : undefined;
        }
        return acc;
    }, {} as Record<string, any>);
    const template = {
        ...baseTemplate,
        ...additionalProps,
    }
    console.log("template:::", template)
    return template;
}