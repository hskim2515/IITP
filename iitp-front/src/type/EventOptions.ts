import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import GeometryType from "@type/FeatureOptions";

export interface EventOptions {
    olLayer?: BaseLayer | VectorLayer | ImageLayer | WebGLVectorLayer
    drawGeometryType?: GeometryType
    olLayers?: [BaseLayer | VectorLayer | ImageLayer | WebGLVectorLayer]
}