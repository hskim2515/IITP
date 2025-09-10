import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Feature } from "ol";
import { Fill, Stroke, Style } from "ol/style";
import { LineString, Point } from "ol/geom";
import { RailPublicStationResponse } from "@type/Station";
import { fromLonLat } from "ol/proj";
import CircleStyle from "ol/style/Circle";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";
import { useSchemaStore } from "@stores/useSchemaStore";

export default class RailStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railStation"
    private unsubscribe: (() => void) | undefined;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 400,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });

        this.source = source;
        this.load(); // 초기 로드
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state: { currentJsonData: RailPublicStationResponse; }) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load(); // 데이터가 변경되면 레이어를 다시 로드합니다.
                },
                { equalityFn: (a:RailPublicStationResponse, b:RailPublicStationResponse) => Object.keys(diff(a, b)).length === 0  }
            );
        }
    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const props = feature.getProperties() ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        if (geom instanceof Point && props.featureType === "railStations") {
            styles.push(
                new Style({
                    image: new CircleStyle({
                        radius: 6,
                        fill: new Fill({color: "rgb(0,102,255)"}), // 빨간색
                        stroke: new Stroke({color: "rgba(0,0,0,0)", width: 1}),
                    }),
                })
            );
        }

        if (geom instanceof Point && props.featureType === "exits") {
            styles.push(
                new Style({
                    image: new CircleStyle({
                        radius: 6,
                        fill: new Fill({color: "rgb(153,0,255)"}), // 빨간색
                        stroke: new Stroke({color: "rgba(0,0,0,0)", width: 1}),
                    }),
                })
            );
        }

        if (geom instanceof LineString && props.featureType === "railStationCorridors") {
            styles.push(
                new Style({
                    stroke: new Stroke({color: '#56bf26', width: Math.min(6, 0.5 / resolution)}),
                })
            );
        }
        return styles;
    }


    public async load(): Promise<void> {

        const store = layerNameToStoreMap[this.LAYER_NAME]
        const generateTemplateWithLayerNameAndFeatureType = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType
        const railTemplate = generateTemplateWithLayerNameAndFeatureType('busStation', 'busStations')
        const exitTemplate = generateTemplateWithLayerNameAndFeatureType('railStation', 'railStations')

        try {
            const railPublicStationResponse: RailPublicStationResponse | undefined = store.getState().currentJsonData
            if (!railPublicStationResponse) return;
            const railStations = railPublicStationResponse.railStations
            const featureBuffer: Feature[] = [];

            for (const railStation of railStations) {
                const exits = railStation.exits;
                const railStationPoint = new Point(fromLonLat([railStation.coordinates.lng, railStation.coordinates.lat]))
                const railStationPointFeature = new Feature(railStationPoint);
                railStationPointFeature.setProperties({...railTemplate, ...railStation})
                if (railStationPointFeature) featureBuffer.push(railStationPointFeature);

                for (const exit of exits ?? []) {
                    const exitPoint = new Point(fromLonLat([exit.coordinates.lng, exit.coordinates.lat]))
                    const exitPointFeature = new Feature(exitPoint);
                    exitPointFeature.setProperties({...exitTemplate, ...exit})
                    if (exitPointFeature) {
                        featureBuffer.push(exitPointFeature);
                        // 연결 라인 추가
                        // const stationCoord = station.coordinates?.[0];
                        // const exitCoord = exitFeature.getGeometry()?.getCoordinates();
                        // if (stationCoord && exitCoord) {
                        //     const line = new LineString([
                        //         fromLonLat([stationCoord.lng!, stationCoord.lat!]),
                        //         exitCoord,
                        //     ]);
                        //     const lineFeature = new Feature<LineString>(line);
                        //     lineFeature.setProperties({
                        //         featureType: "railStationCorridors",
                        //         stationRef: station.id,
                        //         stationGuidRef: station.__guid,
                        //         exitRef: exit.id,
                        //         menuCode: MENU_CODE.RAIL_STATION
                        //     });
                        //     featureBuffer.push(lineFeature);
                        // }
                    }
                }
            }
            this.source.clear();
            this.source.addFeatures(featureBuffer);
        } catch (e) {
            console.error("RailStationLayer.load 에러:", e);
        }
    }

    public dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        super.dispose();
    }
}