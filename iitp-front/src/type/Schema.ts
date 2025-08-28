// Field 내부 options 배열의 요소 타입
export interface FieldOption {
    id: number;
    value: string;
}

// schemaColumns 내부 options 배열의 요소 타입
export interface SchemaColumnOption {
    value: string;
}

// inputType으로 사용될 수 있는 값들의 타입
export type InputType = "text" | "textarea" | "select" | "number" | "checkbox" | "tags";

// status로 사용될 수 있는 값들의 타입
export type Status = "ACTIVE" | "INACTIVE";

// schemata 배열 내부 fields 배열의 요소 타입
export interface Field {
    id: number;
    name: string;
    inputType: InputType;
    readOnly: boolean;
    nullable: boolean;
    status: Status;
    options: FieldOption[];
}

// 기본값 schemaColumns 배열의 요소 타입
export interface SchemaColumn {
    columnKey: 'name' | 'inputType' | 'readOnly' | 'nullable' | 'status' | 'options'
    inputType: InputType | 'tags';
    options: SchemaColumnOption[];
}

// 최상위 schemata 배열의 요소 타입
export interface Schema {
    id: number;
    name: string;
    status: Status;
    fields: Field[];
}

// 백엔드 응답 데이터의 루트 객체 타입
export interface LayerSchema {
    layerId: number;
    layerName: string;
    schemaColumns: SchemaColumn[];
    schemata: Schema[];
}

// 최종적으로 백엔드로부터 받는 데이터의 전체 타입 (배열)
export type LayerSchemaResponse = LayerSchema[];

export interface CreateFieldOptionRequest {
    value: FieldOption['value'];
}

export type CreateFieldRequest = {
    name: Field['name'];
    nullable: Field['nullable'];
    readOnly: Field['readOnly'];
    status: Field['status'];
} & (
    | {
    inputType: 'select';
    options: CreateFieldOptionRequest[];
}
    | {
    inputType: Exclude<InputType, 'select'>;
    options?: never;
}
    );

export interface UpdateFieldOptionRequest extends FieldOption {}
export type UpdateFieldRequest = {
    id: Field['id']
} & (
    // 시나리오 1: inputType을 'select'로 명시적으로 변경/설정하는 경우
    {
        inputType: 'select';
        name?: Field['name'];
        nullable?: Field['nullable'];
        readOnly?: Field['readOnly'];
        status?: Field['status'];
        /** 'select' 타입으로 변경 시 새로운 옵션(id 없음)과 기존 옵션 수정(id 있음)을 모두 포함할 수 있습니다. */
        options?: UpdateFieldOptionRequest[];         // update
        optionsToCreate?: CreateFieldOptionRequest[]; // create
        optionIdsToDelete?: number[];                 // delete
    }
    |
    // 시나리오 2: inputType을 'select'가 아닌 다른 것으로 명시적으로 변경하는 경우
    {
        inputType: Exclude<InputType, 'select'>;
        name?: Field['name'];
        nullable?: Field['nullable'];
        readOnly?: Field['readOnly'];
        status?: Field['status'];
        /** 이 경우 options를 보내는 것을 금지합니다. */
        options?: never;
    }
    |
    // 시나리오 3: inputType을 변경하지 않고 다른 속성만 변경하는 경우
    {
        inputType?: never;
        name?: Field['name'];
        nullable?: Field['nullable'];
        readOnly?: Field['readOnly'];
        status?: Field['status'];
        /** 기존 'select' 필드의 옵션만 수정 가능하므로 id가 있는 UpdateFieldOptionRequest만 허용합니다. */
        options?: UpdateFieldOptionRequest[];
    }
    );

export interface DeleteFieldRequest {
    id: Field['id'];
}
export interface SchemaFieldsRequest {
    id: Schema['id'];
    fieldsToCreate?: CreateFieldRequest[];
    fieldsToUpdate?: UpdateFieldRequest[];
    fieldIdsToDelete?: Field['id'][];
}
