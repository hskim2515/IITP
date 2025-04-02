import {Tile as TileLayer} from "ol/layer";
import {XYZ} from "ol/source";
import * as Cesium from "cesium";

const apiKey = 'A6260B9D-ADEA-36CE-8000-4C4C57D4FCF5';

type SourceMap = {
    [key: string]: string;
};

const sourceMap:SourceMap = {
    'osm' : `https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png`,
    'base': `http://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Base/{z}/{y}/{x}.png`,
    'satellite': `http://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Satellite/{z}/{y}/{x}.jpeg`,
    'hybrid': `http://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Hybrid/{z}/{y}/{x}.png`,
};

export const createOlLayer = (layerType:string) => {
    const url = sourceMap[layerType] || '';
    return new TileLayer({ visible: true, source: new XYZ({ url }),});
};

export const createCesiumLayer = (layerType:string) => {
    return new Cesium.UrlTemplateImageryProvider({ url: sourceMap[layerType] });
};
export const removeAllCesiumLayers = (viewer:Cesium.Viewer) => {
    const imageryLayers = viewer.imageryLayers;

    while (imageryLayers.length > 1) {
        imageryLayers.remove(imageryLayers.get(1));
    }
};