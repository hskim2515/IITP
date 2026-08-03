import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { Map as OLMap, MapBrowserEvent } from 'ol';

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
    layer: BaseLayer | null,
    key: K,
    value: V
): layer is BaseLayer & Record<K, V> {
    if(layer === null) return false;
    // OL 관례인 layer.set(key, value) 값 우선 — BaseObject#set() 은 직접 프로퍼티가 아니라
    // 내부 values_ 에 저장되므로 get() 으로 읽어야 한다 (직접 프로퍼티만 보면
    // set() 으로 등록한 레이어(예: network-mvt)가 영원히 매칭되지 않는다).
    if (typeof (layer as any)?.get === "function" && (layer as any).get(key) === value) return true;
    return hasCustomKeys(layer, key) && (layer as BaseLayer & Record<K, V>)[key] === value;
}

export function findLayerByKeyValue(olMap: OLMap, key: string, value: string | number | boolean | undefined) {
    return olMap.getAllLayers().find(l => matchesCustomKeyValue(l, key, value))
}
