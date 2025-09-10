export function generateGUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0; // 0~15 랜덤 정수
        const v = c === 'x' ? r : (r & 0x3) | 0x8; // RFC4122 규칙 적용
        return v.toString(16);
    });
}

// function addMultiplePropertiesRecursively(
//     obj: any,
//     type: string,
//     propertyGenerators: Record<string, (type: string) => any>
// ) {
//     if (Array.isArray(obj)) {
//         obj.forEach(item => addMultiplePropertiesRecursively(item, type, propertyGenerators));
//     } else if (typeof obj === 'object' && obj !== null) {
//         for (const [keyName, generator] of Object.entries(propertyGenerators)) {
//             if (obj[keyName] === undefined || obj[keyName] === null) {
//                 obj[keyName] = generator(type);
//             }
//         }
//         Object.entries(obj).forEach(([key, value]) => {
//             if (Array.isArray(value)) {
//                 addMultiplePropertiesRecursively(value, key, propertyGenerators);
//             }
//         });
//     }
// }


// export function assignPropertyToResponseData(data: any, menuCode: string): any {
//     const propertyGenerators = {
//         __guid: generateGUIDWithType,
//         featureType: generateFeatureTypeWithType,
//         menuCode: () => menuCode,
//     };
//
//     Object.keys(data).forEach(key => {
//         addMultiplePropertiesRecursively(data[key], key, propertyGenerators);
//     });
//
//     return data;
// }



export function generateGUIDWithType(type:string): string {
    return `${ type }-${ generateGUID() }`;
}

export function generateFeatureTypeWithType(type:string): string {
    return type;
}

//
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

export function assignPropertyToResponseData(data: any, menuCode: string): any {
    const propertyGenerators = {
        __guid: (path: string[]) => generatePathGUID(path),
        featureType: (path: string[]) => path[path.length - 1]?.split("-")[0] ?? "unknown",
        menuCode: () => menuCode,
    };

    Object.keys(data).forEach(key => {
        addMultiplePropertiesRecursively(data[key], [key], propertyGenerators);
    });

    return data;
}
