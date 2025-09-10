import { Field, Schema } from "@type/Schema";
import React from "react";

const EXCLUDED_NESTED_FIELDS = ["coordinates"];

/**
 * 전체 데이터에서 중첩 배열 필드들을 분석하여 반환
 * 모든 행을 검사하므로 특정 행이 제거되어도 영향받지 않음
 */
export function analyzeNestedArrayFields(data: any[]): string[] {
    if (!data || data.length === 0) return [];

    const nestedFields = new Set<string>();

    // 모든 행을 검사하여 중첩 배열 필드 수집
    for (const row of data) {
        if (!row || typeof row !== 'object') continue;

        for (const key in row) {
            if (EXCLUDED_NESTED_FIELDS.includes(key)) continue;

            const value = row[key];
            if (Array.isArray(value) &&
                value.length > 0 &&
                value.some(item => typeof item === 'object' && item !== null)) {
                nestedFields.add(key);
            }
        }
    }

    return Array.from(nestedFields);
}

/**
 * 개선된 GUID 경로 찾기 함수
 * 전체 데이터 구조를 미리 분석하여 사용
 */
export function findGuidPath(
    data: any[],
    targetGuid: string | React.Key,
    path: string[] = [],
    nestedFields?: string[]
): string[] | null {
    // 중첩 필드가 제공되지 않았다면 분석
    if (!nestedFields) {
        nestedFields = analyzeNestedArrayFields(data);
    }

    for (const row of data) {
        if (!row || typeof row !== 'object') continue;

        if (row.__guid === targetGuid) {
            return [...path, row.__guid];
        }

        // 미리 분석된 중첩 필드들을 사용
        for (const field of nestedFields) {
            const children = row[field];
            if (Array.isArray(children) && children.length > 0) {
                const result = findGuidPath(children, targetGuid, [...path, row.__guid], nestedFields);
                if (result) return result;
            }
        }
    }

    return null;
}

/**
 * 개선된 컬럼 생성 함수
 * 더 안전한 고유값 추출과 필터 생성
 */
export function generateColumnsFromSchema(
    data: any[],
    schema: Schema | null,
) {
    if (!schema || !Array.isArray(schema.fields)) return [];

    return schema.fields
        .filter(field => field?.status === 'ACTIVE')
        .map(field => {
            const uniqueValues = extractUniqueValues(data, field.name);

            return {
                title: formatFieldTitle(field.name),
                dataIndex: field.name,
                key: field.name,
                filters: getFilters(field, uniqueValues),
                fieldSchema: field,
            };
        });
}

/**
 * 필드명에서 안전하게 고유값 추출
 */
function extractUniqueValues(data: any[], fieldName: string): any[] {
    if (!data || data.length === 0) return [];

    const values = new Set();

    for (const item of data) {
        if (item && typeof item === 'object' && fieldName in item) {
            const value = item[fieldName];
            if (value !== undefined && value !== null && value !== '') {
                values.add(value);
            }
        }
    }

    return Array.from(values);
}

/**
 * 필드명을 표시용 제목으로 변환
 */
function formatFieldTitle(fieldName: string): string {
    if (!fieldName) return '';

    return fieldName
        .split(/[_-]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * 개선된 필터 생성 함수
 */
function getFilters(field: Field, uniqueValues: any[]) {
    if (!field) return [];

    // 체크박스 타입
    if (field.inputType === 'checkbox') {
        return [
            { text: 'True', value: true },
            { text: 'False', value: false }
        ];
    }

    // 셀렉트 타입 with 옵션
    if (field.inputType === 'select' && Array.isArray(field.options)) {
        return field.options
            .filter(option => option && option.value !== undefined)
            .map(option => ({
                text: String(option.value || option.value),
                value: option.value
            }));
    }

    // 숫자 타입인 경우 정렬
    const isNumeric = uniqueValues.every(val =>
        typeof val === 'number' || !isNaN(Number(val))
    );

    let sortedValues = [...uniqueValues];
    if (isNumeric) {
        sortedValues.sort((a, b) => Number(a) - Number(b));
    } else {
        sortedValues.sort();
    }

    // 최대 10개로 제한하되, 너무 많으면 경고
    const maxFilters = 10;
    if (sortedValues.length > maxFilters) {
        console.warn(`Field '${field.name}' has ${sortedValues.length} unique values. Only showing first ${maxFilters}.`);
        sortedValues = sortedValues.slice(0, maxFilters);
    }

    return sortedValues.map(val => ({
        text: String(val),
        value: val
    }));
}

/**
 * 데이터 구조 검증 함수 (추가)
 */
export function validateDataStructure(data: any[]): {
    isValid: boolean;
    issues: string[];
    nestedFields: string[];
} {
    const issues: string[] = [];

    if (!Array.isArray(data)) {
        issues.push('Data is not an array');
        return { isValid: false, issues, nestedFields: [] };
    }

    if (data.length === 0) {
        issues.push('Data array is empty');
        return { isValid: false, issues, nestedFields: [] };
    }

    const nestedFields = analyzeNestedArrayFields(data);

    // GUID 필드 검증
    const hasGuidField = data.some(row =>
        row && typeof row === 'object' && '__guid' in row
    );

    if (!hasGuidField) {
        issues.push('No __guid field found in data');
    }

    return {
        isValid: issues.length === 0,
        issues,
        nestedFields
    };
}

export function getNestedFieldsFromSchema(schema: Schema): string[] {
    if (!schema.fields) return [];
    return schema.fields
        .filter(field => Array.isArray(field))
        .map(field => field.name);
}
