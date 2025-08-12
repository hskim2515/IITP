import { Style } from "ol/style";
import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";

export interface FeatureLayerAPI {
    getDefaultStyle(): Style | undefined;
    getSelectStyle(): Style | undefined;
    getFeatureType(): string | undefined;
    getSnapFeatureType(): string | undefined;
    getSnapLayerKey(): string | undefined;
    recordToDto(record: any, type?: string): any;
    recordToSnapProperties(record: any, type?: string): any;
    computeMetadata(snapFeature: any, snapProps: any, fromCoord: number[], type?: string): any;
    snapPropertiesToDto(meta: any, dto: any): any;
}

export function isFeatureLayer(layer: unknown): layer is FeatureLayerAPI & VectorLayer & WebGLVectorLayer {
    return (
        typeof layer === 'object' &&
        layer !== null &&
        'getDefaultStyle' in layer &&
        typeof (layer as any).getDefaultStyle === 'function' &&
        'getSelectStyle' in layer &&
        typeof (layer as any).getSelectStyle === 'function' &&
        'getFeatureType' in layer &&
        typeof (layer as any).getFeatureType === 'function' &&
        'recordToDto' in layer &&
        typeof (layer as any).recordToDto === 'function'
    );
}