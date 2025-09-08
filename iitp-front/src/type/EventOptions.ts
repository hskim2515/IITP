import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import GeometryType from "@type/FeatureOptions";
import Collection from "ol/Collection";
import Feature from "ol/Feature";
import Geometry from "ol/geom/Geometry";
import { StyleLike } from "ol/style/Style";

export interface EventOptions {
    olLayer?: BaseLayer | VectorLayer | WebGLVectorLayer
    drawGeometryType?: GeometryType
    olLayers?: [BaseLayer | VectorLayer | WebGLVectorLayer]
    features?: Collection<Feature<Geometry>>
    style?: StyleLike | null | undefined;
}