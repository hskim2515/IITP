import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import GeometryType from "@type/FeatureOptions";
import Collection from "ol/Collection";
import Feature from "ol/Feature";
import Geometry from "ol/geom/Geometry";
import { StyleLike } from "ol/style/Style";
import { Layer } from "ol/layer";
import { Source } from "ol/source";
import LayerRenderer from "ol/renderer/Layer";

export interface OLEventOptions {
    olLayer?: BaseLayer | VectorLayer | WebGLVectorLayer
    drawGeometryType?: GeometryType
    olLayers?: Layer<Source, LayerRenderer<any>>[] | ((arg0: Layer<Source, LayerRenderer<any>>) => boolean) | undefined
    features?: Collection<Feature<Geometry>>
    style?: StyleLike | null | undefined;
}

export interface CesiumEventOptions {

}

export interface EventOptions extends OLEventOptions, CesiumEventOptions {

}