
export function generateGUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0; // 0~15 랜덤 정수
        const v = c === 'x' ? r : (r & 0x3) | 0x8; // RFC4122 규칙 적용
        return v.toString(16);
    });
}


export function assignGUIDsToTrafficData(data: any) {
    const addIdRecursively = (obj: any, type: string) => {
        if (Array.isArray(obj)) {
            obj.forEach((item) => addIdRecursively(item, type));
        } else if (typeof obj === 'object' && obj !== null) {
            obj.__guid = `${type}-${generateGUID()}`;
            for (const key in obj) {
                if (Array.isArray(obj[key])) {
                    addIdRecursively(obj[key], key); // 예: 'lanes', 'cells'
                }
            }
        }
    };

    if (data.links) addIdRecursively(data.links, 'link');
    if (data.nodes) addIdRecursively(data.nodes, 'node');
    if (data.connections) addIdRecursively(data.connections, 'connection');
    if (data.signals) addIdRecursively(data.signals, 'signal');

    return data;
}