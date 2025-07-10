export function generateGUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0; // 0~15 랜덤 정수
        const v = c === 'x' ? r : (r & 0x3) | 0x8; // RFC4122 규칙 적용
        return v.toString(16);
    });
}

export function addIdRecursively(obj: any, type: string) {
    if (Array.isArray(obj)) {
        obj.forEach((item) => addIdRecursively(item, type));
    } else if (typeof obj === 'object' && obj !== null) {
        if (!obj.__guid) { // 중복 생성 방지
            obj.__guid = generateGUIDWithType(type)
        }
        for (const key in obj) {
            if (Array.isArray(obj[key])) {
                addIdRecursively(obj[key], key); // 예: 'lanes', 'cells'
            }
        }
    }
};

export function generateGUIDWithType(type:string): string {
    return `${ type }-${ generateGUID() }`;
}

export function assignGUIDsToResponseData(data: any) {
    if (data.links) addIdRecursively(data.links, 'link');
    if (data.nodes) addIdRecursively(data.nodes, 'node');
    if (data.connections) addIdRecursively(data.connections, 'connection');
    if (data.signals) addIdRecursively(data.signals, 'signal');

    if (data.busStations) addIdRecursively(data.busStations, 'busStations');
    if (data.pavementMarkings) addIdRecursively(data.pavementMarkings, 'pavementMarkings');
    return data;
}

export function generateFeatureTypeWithType(type:string): string {
    return type;
}

export function addFeatureTypeRecursively(obj: any, type: string) {
    if (Array.isArray(obj)) {
        obj.forEach((item) => addFeatureTypeRecursively(item, type));
    } else if (typeof obj === 'object' && obj !== null) {
        if (!obj.featureType) { // 중복 생성 방지
            obj.featureType = generateFeatureTypeWithType(type)
        }
        for (const key in obj) {
            if (Array.isArray(obj[key])) {
                addFeatureTypeRecursively(obj[key], key); // 예: 'lanes', 'cells'
            }
        }
    }
};
export function assignFeatureTypeToResponseData(data: any) {
    if (data.links) addFeatureTypeRecursively(data.links, 'link');
    if (data.nodes) addFeatureTypeRecursively(data.nodes, 'node');
    if (data.connections) addFeatureTypeRecursively(data.connections, 'connection');
    if (data.signals) addFeatureTypeRecursively(data.signals, 'signal');
    if (data.busStations) addFeatureTypeRecursively(data.busStations, 'busStations');
    if (data.pavementMarkings) addFeatureTypeRecursively(data.pavementMarkings, 'pavementMarkings');
    return data;
}