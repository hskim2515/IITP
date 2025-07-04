
export function applyDiffs(obj: any, diffs: { path: string[], value: any }[]) {
    const clone = structuredClone(obj);
    for (const { path, value } of diffs) {
        let current = clone;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!current[key] || typeof current[key] !== "object") {
                current[key] = {};
            }
            current = current[key];
        }
        current[path[path.length - 1]] = value;
    }
    return clone;
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
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every((key) => deepEqual(a[key], b[key]));
    }

    return false;
}