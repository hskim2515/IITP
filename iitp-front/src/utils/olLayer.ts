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

export function hasCustomKeys<K extends string>(
    layer: BaseLayer,
    ...requiredKeys: K[]
): layer is BaseLayer & Record<K, unknown> {
    return requiredKeys.every((key) => key in layer);
}

export function matchesCustomKeyValue<
    K extends string,
    V extends string | number | boolean | undefined
>(
    layer: BaseLayer,
    key: K,
    value: V
): layer is BaseLayer & Record<K, V> {
    return hasCustomKeys(layer, key) && (layer as BaseLayer & Record<K, V>)[key] === value;
}