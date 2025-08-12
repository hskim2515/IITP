import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";

// 기존 타입 가드들
export function isVectorLayer(layer: BaseLayer): layer is VectorLayer {
    return layer instanceof VectorLayer;
}

export function isWebGLVectorLayer(layer: BaseLayer): layer is WebGLVectorLayer {
    return layer instanceof WebGLVectorLayer;
}

export function hasCustomKeys<T extends string>(
    layer: BaseLayer,
    ...requiredKeys: T[]
): layer is BaseLayer & Record<T, string | number | boolean | undefined> {
    return requiredKeys.every(key => key in layer);
}

export function matchesCustomKeyValue<T extends string>(
    layer: BaseLayer,
    key: string,
    value: string | number | boolean | undefined
): layer is BaseLayer & Record<T, string | number | boolean | undefined> {
    return hasCustomKeys(layer, key) === value;
}

export function setCustomKeyValue<T extends string>(
    layer: BaseLayer,
    key: string,
    value: string | number | boolean | undefined
):void {
    if(isVectorLayer(layer) || isWebGLVectorLayer(layer)) {
        layer[key] = value
    }
}