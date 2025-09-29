export function findParentRecordByFeatureType(
    json: any,
    record: { __guid: string, featureType: string }
): { parent: any; key: string } | null {
    console.log("findParentRecordByFeatureType")
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

export function findParentRecordByGuid(
    json: any,
    record: { __guid: string; parentGuid: string, featureType: string }
): { parent: any; key: string } | null {
    const { __guid, parentGuid, featureType } = record;
    if (!parentGuid || !__guid) return null;

    function search(obj: any): { parent: any; key: string } | null {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = search(item);
                if (found) return found;
            }
        } else if (typeof obj === "object" && obj !== null) {
            // 부모 객체 guid 매칭
            if (obj.__guid === parentGuid) {
                for (const [key, value] of Object.entries(obj)) {
                    if (
                        Array.isArray(value) &&
                        !value.some((v: any) => v?.__guid === __guid)
                    ) {
                        return { parent: obj, key };
                    }
                }
                const childKey = featureType;
                if (!childKey || typeof childKey !== "string") return null;

                if (!Array.isArray(obj[childKey])) {
                    obj[childKey] = [];
                }
                return { parent: obj, key: childKey };
            }

            // 재귀 탐색
            for (const value of Object.values(obj)) {
                const found = search(value);
                if (found) return found;
            }
        }

        return null;
    }

    return search(json);
}

