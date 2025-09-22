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
 * GUID 경로 찾기 함수
 */
export function findGuidPath(
    data: any[],
    targetGuid: string | React.Key,
    path: string[] = [],
    nestedFields?: string[]
): string[] | null {
    if (!nestedFields) {
        nestedFields = analyzeNestedArrayFields(data);
    }

    for (const row of data) {
        if (!row || typeof row !== 'object') continue;

        if (row.__guid === targetGuid) {
            return [...path, row.__guid];
        }

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

