export function applyDiffs(obj: any, diffs: { path: string[]; value: any }[]): any {
    const clone = structuredClone(obj);

    for (const { path, value } of diffs) {
        setValueAtPath(clone, path, value);
    }

    return clone;
}

/**
 * 지정된 path 위치에 value를 설정하는 재귀 함수
 */
function setValueAtPath(obj: any, path: string[], value: any): void {
    if (path.length === 0) return;

    const key = isNumeric(path[0]) ? Number(path[0]) : path[0];

    if (path.length === 1) {
        obj[key] = value;
        return;
    }

    if (!(key in obj) || typeof obj[key] !== 'object' || obj[key] === null) {
        // 다음 경로가 숫자면 배열로, 아니면 객체로 초기화
        obj[key] = isNumeric(path[1]) ? [] : {};
    }

    setValueAtPath(obj[key], path.slice(1), value);
}

function isNumeric(value: string): boolean {
    return !isNaN(Number(value));
}


export function diffObjects(obj1: any, obj2: any, path: string[] = []): { path: string[], value: any }[] {
    const diffs: { path: string[], value: any }[] = [];
    const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

    for (const key of keys) {
        const fullPath = [...path, key];
        const val1 = obj1?.[key];
        const val2 = obj2?.[key];

        const isObject = (v: any) =>
            typeof v === "object" && v !== null && !Array.isArray(v);

        if (isObject(val1) && isObject(val2)) {
            diffs.push(...diffObjects(val1, val2, fullPath));
        } else if (val1 !== val2) {
            diffs.push({ path: fullPath, value: val2 });
        }
    }

    return diffs;
}

export function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;

    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        return a.every((val, idx) => deepEqual(val, b[idx]));
    }

    if (typeof a === 'object') {
        const keysA = Object.keys(a).sort();
        const keysB = Object.keys(b).sort();
        if (keysA.length !== keysB.length) return false;
        return keysA.every(key =>
            Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key])
        );
    }

    return a === b;
}

/**
 * JSON 객체 내에서 주어진 guid를 가진 객체를 찾아,
 * 해당 객체 자신과 모든 하위 객체의 __guid를 수집.
 */
export function collectGuidsOfTargetAndChildren(data: unknown, targetGuid: string): Set<string> {
    const guidSet = new Set<string>();

    // 타겟 객체를 먼저 찾는 함수
    function findTarget(obj: any): any | null {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findTarget(item);
                if (found) return found;
            }
        } else if (obj && typeof obj === "object") {
            if (obj.__guid === targetGuid) return obj;

            for (const value of Object.values(obj)) {
                const found = findTarget(value);
                if (found) return found;
            }
        }
        return null;
    }

    // guid 수집용 함수 (자기 자신 + 자식)
    function traverse(obj: any) {
        if (Array.isArray(obj)) {
            obj.forEach(traverse);
        } else if (obj && typeof obj === "object") {
            if (obj.__guid) guidSet.add(obj.__guid);
            Object.values(obj).forEach(traverse);
        }
    }

    const target = findTarget(data);
    if (target) {
        traverse(target);
    }

    return guidSet;
}

/**
 * JSON 트리에서 특정 guid를 가진 객체를 찾아,
 * 그 상위 부모 객체(guid를 포함하고 있는 객체)를 반환
 */
export function findParentObjectOfGuid(data: unknown, targetGuid: string): unknown | null {
    function recurse(obj: any, parent: any = null): any | null {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = recurse(item, parent);
                if (found) return found;
            }
        } else if (obj && typeof obj === "object") {
            if (obj.__guid === targetGuid) return parent;

            for (const val of Object.values(obj)) {
                const found = recurse(val, obj);
                if (found) return found;
            }
        }
        return null;
    }

    return recurse(data, null);
}

export function findParentRecordByFeatureType(
    json: any,
    record: { __guid: string, featureType: string }
): { parent: any; key: string } | null {
    const { __guid, featureType } = record;
    if (!featureType || !__guid) return null;

    function search(obj: any): { parent: any; key: string } | null {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = search(item);
                if (found) return found;
            }
        } else if (typeof obj === "object" && obj !== null) {
            for (const [key, value] of Object.entries(obj)) {
                if (
                    key === featureType &&
                    Array.isArray(value) &&
                    !value.some((v: any) => v?.__guid === __guid)
                ) {
                    return { parent: obj, key };
                }

                const found = search(value);
                if (found) return found;
            }
        }

        return null;
    }

    return search(json);
}
