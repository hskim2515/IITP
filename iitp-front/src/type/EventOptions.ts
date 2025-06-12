import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import GeometryType from "@type/FeatureOptions";
import Collection from "ol/Collection";
import Feature from "ol/Feature";
import Geometry from "ol/geom/Geometry";

export interface EventOptions {
    olLayer?: BaseLayer | VectorLayer | ImageLayer | WebGLVectorLayer
    drawGeometryType?: GeometryType
    olLayers?: [BaseLayer | VectorLayer | ImageLayer | WebGLVectorLayer]
    features?: Collection<Feature<Geometry>>
}