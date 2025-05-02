import { Map as OLMap, View } from 'ol';
import { Group, Layer, Tile as TileLayer } from 'ol/layer';
import BaseLayer from 'ol/layer/Base';
import { Source, XYZ } from 'ol/source';
import VectorSource from "ol/source/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import Heatmap from "ol/layer/Heatmap";
import LayerGroup from "ol/layer/Group";
import VectorLayer from "ol/layer/Vector";

export const API_KEY = 'A6260B9D-ADEA-36CE-8000-4C4C57D4FCF5';

export const KEY_CUSTOM_GROUP = 'customGroupName';
export const KEY_CUSTOM_NAME = 'customName';

export default class OlLayerManager {
    private olMap: OLMap;
    private view: View;

    constructor(olMap: OLMap, view: View) {
        this.olMap = olMap;
        this.view = view;
    }

    public getOlMap(): OLMap {
        return this.olMap;
    }

    /** 최상위 그룹 컬렉션(array) 반환 */
    public getAllGroups(): LayerGroup[] {
        return this.olMap
            .getLayerGroup()
            .getLayers()
            .getArray()
            .filter(l => l instanceof LayerGroup) as LayerGroup[];
    }

    /** customGroupName === groupName 인 Group 반환 */
    public getGroup(groupName: string): Group {
        return this.olMap.getLayerGroup().getLayers().getArray()
            .find(l => l.get(KEY_CUSTOM_GROUP) === groupName) as Group;
    }

    /** 없으면 생성, 있으면 기존 반환 */
    public getOrCreateGroup(groupName: string): BaseLayer | undefined {
        let group = this.getGroup(groupName);
        if (!group) {
            group = new Group({ layers: [] });
            group.set(KEY_CUSTOM_GROUP, groupName);
            this.olMap.addLayer(group);
        }
        return group;
    }

    /**
     * 그룹에 레이어 추가
     */
    public addToGroup(
        groupName: string,
        layerName: string,
        layers: TileLayer | Heatmap | WebGLVectorLayer | VectorLayer
    ): void {
        const groupLayer = this.getGroup(groupName)
        if (groupLayer) {
            layers.set(KEY_CUSTOM_NAME, layerName)
            groupLayer.getLayers().push(layers);
        }
    }

    /** 그룹 내 특정 레이어 조회 */
    public getLayerWithGroupName(
        groupName: string,
        layerName: string
    ): Layer<Source> | undefined {
        const group = this.getGroup(groupName);
        return group?.getLayersArray()
            .find(l => l.get(KEY_CUSTOM_NAME) === layerName);
    }

    /** 특정 레이어만 보이게, 나머지는 숨기기 */
    public showBaseLayer(
        groupName: string,
        layerName: string
    ): void {
        const group = this.getGroup(groupName);

        if (!group) return;

        const visibleLayerName = layerName === "hybrid"
            ? [ "hybrid", "satellite" ]
            : [ layerName ]; // hybrid인 경우 둘 다 켜기

        group.getLayersArray().forEach(layer => {
            const customName = layer.get(KEY_CUSTOM_NAME);
            if (visibleLayerName.includes(customName)) {
                layer.setVisible(true);
            } else {
                layer.setVisible(false);
            }
        });
    }

    public showLayer(
        groupName: string,
        activeLayerName: string,
        removeLayerName: string
    ): void {
        const group = this.getGroup(groupName);

        if (!group) return;

        group.getLayersArray().forEach(layer => {
            const layerName = layer.get(KEY_CUSTOM_NAME);
            if (!layerName) return;

            if (layerName === activeLayerName) {
                layer.setVisible(true);
            } else if (layerName === removeLayerName) {
                layer.setVisible(false);
            }
        });
    }

    /** 그룹 삭제 */
    public removeGroup(groupName: string): void {
        const group = this.getGroup(groupName);
        if (!group) return;
        group.dispose();
    }

    /** 그룹 보이기/숨기기 */
    public showGroup(groupName: string): void {
        this.getGroup(groupName)?.setVisible(true);
    }

    public hideGroup(groupName: string): void {
        this.getGroup(groupName)?.setVisible(false);
    }

    /** 그룹 생성, 생성한 그룹에 레이어 생성 */
    public createRootGroup(schema: any): void {
        schema.map((layerGroup) => {
            this.getOrCreateGroup(layerGroup.key)
        })
    }

    public createBaseLayer() {
        this.addToGroup("baseMap", "osm", new TileLayer({
            visible: true,
            zIndex: 1,
            source: new XYZ({
                url: 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png'
            })
        }))
        this.addToGroup("baseMap", "base", new TileLayer({
            visible: true,
            zIndex: 1,
            source: new XYZ({
                url: `http://api.vworld.kr/req/wmts/1.0.0/${ API_KEY }/Base/{z}/{y}/{x}.png`
            })
        }))

        this.addToGroup("baseMap", "satellite", new TileLayer({
            visible: true,
            zIndex: 1,
            source: new XYZ({
                url: `http://api.vworld.kr/req/wmts/1.0.0/${ API_KEY }/Satellite/{z}/{y}/{x}.jpeg`
            })
        }))

        this.addToGroup("baseMap", "hybrid", new TileLayer({
            visible: true,
            zIndex: 1,
            source: new XYZ({
                url: `http://api.vworld.kr/req/wmts/1.0.0/${ API_KEY }/Hybrid/{z}/{y}/{x}.png`
            })
        }))
    }

    public createAnalysisLayer() {
        const vehicleSource = new VectorSource();

        const vehicleLayer = new WebGLVectorLayer({
            source: vehicleSource,
            visible: true,
            style: {
                'circle-radius': 5,
                'circle-fill-color': 'rgb(84,182,255)',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
            },
            zIndex: 110,
        })

        this.getOrCreateGroup("vehicle")
        this.addToGroup("vehicle", "vehicle", vehicleLayer);

        const heatmapLayer = new Heatmap({
            source: vehicleSource,
            blur: 15,
            radius: 8,
            weight: () => 1,
            visible: false,
            zIndex: 220,
        });
        this.addToGroup("layer", "heatmap", heatmapLayer);

        const tripStyle =
            {
                'circle-radius': 5,
                'circle-fill-color': 'rgb(255,130,84)',
                'circle-stroke-color': '#ffd7a1',
                'circle-stroke-width': 2,
                'stroke-color': 'rgb(149,122,112,0.5)',
                'stroke-width': 2,
            }

        const tripLayer = new WebGLVectorLayer({
            source: vehicleSource,
            style: tripStyle,
            visible: false,
            zIndex: 130,
        });

        this.addToGroup("layer", "trip", tripLayer);
    }

    public createODMatrixLayer() {

    }
}
