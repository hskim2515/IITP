export function generateGUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0; // 0~15 랜덤 정수
        const v = c === 'x' ? r : (r & 0x3) | 0x8; // RFC4122 규칙 적용
        return v.toString(16);
    });
}

export function generateGUIDWithType(type: string): string {
    return `${type}-${generateGUID()}`;
}

function generatePathGUID(path: string[]): string {
    return path.join(".");
}

function addMultiplePropertiesRecursively(
    obj: any,
    path: string[],
    propertyGenerators: Record<string, (path: string[]) => any>
) {
    if (Array.isArray(obj)) {
        obj.forEach((item, index) =>
            addMultiplePropertiesRecursively(item, [...path.slice(0, -1), `${path[path.length - 1]}-${index}`], propertyGenerators)
        );
    } else if (typeof obj === "object" && obj !== null) {
        for (const [keyName, generator] of Object.entries(propertyGenerators)) {
            if (obj[keyName] === undefined || obj[keyName] === null) {
                obj[keyName] = generator(path);
            }
        }
        Object.entries(obj).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                addMultiplePropertiesRecursively(value, [...path, key], propertyGenerators);
            }
        });
    }
}

export function assignPropertyToResponseData<T extends Record<string, unknown>>(data: T): T {
    const propertyGenerators = {
        __guid: (path: string[]) => generatePathGUID(path),
        featureType: (path: string[]) => path[path.length - 1]?.split("-")[0] ?? "unknown",
    };

    Object.keys(data).forEach(key => {
        addMultiplePropertiesRecursively(data[key], [key], propertyGenerators);
    });
    return data;
}

// 새로운 객체를 그릴 때, guid 부여
export function generateGuidWithParentGuid<T extends Record<string, unknown>, U extends Record<string, unknown>>(parentGuid: React.Key | null, data: T, rowData: U) {
    const prefix = parentGuid ? parentGuid + "." : "";
    const newIndex = rowData.length

    const guid = prefix + data.featureType + "-" + newIndex
    data.__guid = guid;
}

export function extractFeatureTypeFromGuid(guid: React.Key): string | null {
    const s = String(guid);
    if (!s) return null;

    // guid 예: "railStations-1.exits-1"  → segments: ["railStations-1","exits-1"]
    const lastSegment = s.split(".").pop() ?? "";
    // lastSegment 예: "exits-1" → ["exits","1"]
    const [type] = lastSegment.split("-");
    return type || null;
}