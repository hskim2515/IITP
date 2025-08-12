import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useLayerStore } from "@stores/useLayerStore";
import { Feature } from "ol";
import { Fill, Stroke, Style, } from "ol/style";
import { LineString, Point, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";
import {layerNameToStoreMap, menuCodeToStoreMap} from "@hooks/useLayerInit";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Coordinate } from "ol/coordinate";
import { SNAP_FEATURE_TYPE } from "@type/Station";

export default class NetworkFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "network"

    private unsubscribe: () => void;
    private zIndexMap: Record<string, number> = {
        "link": 10,
        "link-edit": 110,
        "lane": 20,
        "lane-edit": 120,
        "connection": 30,
        "connection-edit": 130,
    };

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
            zIndex: 300,
        });
        // LayerStore에서 활성화된 레이어 이름(필요 시 visible 제어)
        const layerStore = useLayerStore.getState();

        const activeLayerName = layerStore.activeLayerName;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            (jsonData) => {
                if (!Array.isArray(jsonData) || jsonData.length === 0) return;
                // JSON 레코드가 변경되었으니, load()를 통해 피처를 재생성
                this.load().catch((error) =>
                    console.error("[NetworkFeatureLayer] load failed:", error)
                );
            },
            { fireImmediately: true }
        );

        this.source = source;


    }

    public styleFunction(feature: Feature, resolution: number): Style[] {
        const props = feature.getProperties() ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        // featureType 별로 zIndex 나누기 위한 변수
        const featureType = props.featureType ?? "";
        const zIndex = this.zIndexMap[featureType] ?? 0;

        if (geom instanceof Polygon && props.featureType === "link") {
            styles.push(new Style({
                fill: new Fill({ color: "#000000" }),
                zIndex
            }));
        }

        if (geom instanceof LineString && props.featureType === "link-edit") {
            styles.push(new Style({
                stroke: new Stroke({ color: "#ffea00", width: Math.min(3, 0.5 / resolution) }),
                zIndex
            }));
        }

        if (geom instanceof Polygon && props.featureType === "lane") {
            styles.push(new Style({
                fill: new Fill({ color: "#7f7f7f" }),
                stroke: new Stroke({ color: "#ffffff", width: Math.min(2, 0.5 / resolution) }),
                zIndex
            }));
        }

        if (geom instanceof LineString && props.featureType === "lane-edit") {
            styles.push(new Style({
                stroke: new Stroke({ color: "#003cff", width: Math.min(3, 0.5 / resolution) }),
                zIndex
            }));
        }

        if (geom instanceof Polygon && props.featureType === "connection") {
            styles.push(new Style({
                fill: new Fill({ color: "rgba(0,0,0,0.3)" }),
                zIndex
            }));
        }

        if (geom instanceof LineString && props.featureType === "connection-edit") {
            let color = "#ffffff";

            styles.push(new Style({
                stroke: new Stroke({ color, width: Math.min(3, 0.5 / resolution) }),
                zIndex
            }));

            const coordinates = geom.getCoordinates();
            if (coordinates.length >= 2) {
                const [ start, end ] = [ coordinates[coordinates.length - 2], coordinates[coordinates.length - 1] ];
                const dx = end[0] - start[0];
                const dy = end[1] - start[1];
                const len = Math.hypot(dx, dy);
                if (len === 0) return [];

                const ux = dx / len;
                const uy = dy / len;

                const nx = -uy;
                const ny = ux;

                const arrowLength = 1.8
                const baseWidth = 0.8

                const baseCenter: [ number, number ] = [
                    end[0] - ux * arrowLength,
                    end[1] - uy * arrowLength,
                ];

                // base 좌우 계산
                const baseLeft: [ number, number ] = [
                    baseCenter[0] + nx * baseWidth / 2,
                    baseCenter[1] + ny * baseWidth / 2,
                ];
                const baseRight: [ number, number ] = [
                    baseCenter[0] - nx * baseWidth / 2,
                    baseCenter[1] - ny * baseWidth / 2,
                ];

                styles.push(new Style({
                    geometry: new Polygon([ [ baseLeft, baseRight, end, baseLeft ] ]),
                    fill: new Fill({ color }),
                    stroke: new Stroke({ color, width: 0.1 }),
                }));
            }

        }

        // node 임시 비활성화
        // if (geom instanceof Point && props.featureType === "node") {
        //     styles.push(new Style({
        //         image: new RegularShape({
        //             points: 4,
        //             radius: 4,
        //             angle: Math.PI / 4,
        //             fill: new Fill({ color: "#000000" }),
        //             stroke: new Stroke({ color: "#ffffff", width: 1 }),
        //         }),
        //     }));
        // }

        return styles;
    }

    private getRatioBasedBezierPoints(
        from: Coordinate,
        to: Coordinate,
        node: Coordinate,
        segmentCount: number = 100,
        ratioAlongLine: number = 0.15,
        nodePullScale: number = 0.5
    ): [ number, number ][] {
        // from → to 선분 상의 점 P
        const px = from[0] + (to[0] - from[0]) * ratioAlongLine;
        const py = from[1] + (to[1] - from[1]) * ratioAlongLine;

        // P → node 방향 벡터에 scale 적용
        const dx = node[0] - px;
        const dy = node[1] - py;
        const cx = px + dx * nodePullScale;
        const cy = py + dy * nodePullScale;
        const control: [ number, number ] = [ cx, cy ];

        // Quadratic Bezier 보간
        const points: [ number, number ][] = [];
        for (let i = 0; i <= segmentCount; i++) {
            const t = i / segmentCount;
            const x = (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t ** 2 * to[0];
            const y = (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1];
            points.push([ x, y ]);
        }

        return points;
    }


    public async load(): Promise<void> {

        const store = layerNameToStoreMap[this.LAYER_NAME]

        try {
            const { nodes, links, lanes, cells, segments } = store.getState().originData;
            const selectedScenario = useScenarioStore.getState().selectedScenario;

            const baseLng = selectedScenario.longitude;
            const baseLat = selectedScenario.latitude;
            const scaleX = 1 / 88000;
            const scaleY = 1 / 111000;

            const toCoord = (x: number, y: number) =>
                fromLonLat([ baseLng + x * scaleX, baseLat + y * scaleY ]);

            const featureBuffer: Feature[] = [];
            const laneMap = new Map<string, Feature>();

            for (const link of links) {
                const [ firstPt, lastPt ] = link.shape.split(" ");
                const [ x1, y1 ] = firstPt.split(",").map(parseFloat);
                const [ x2, y2 ] = lastPt.split(",").map(parseFloat);
                const p1 = toCoord(x1, y1);
                const p2 = toCoord(x2, y2);

                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const len = Math.hypot(dx, dy);
                const unitNormal: [ number, number ] = len > 0 ? [ -dy / len, dx / len ] : [ 0, 0 ];

                const linkLine = new LineString([ p1, p2 ]);
                const linkLineFeature = new Feature(linkLine)
                linkLineFeature.setProperties({ ...link, featureType: "link-edit", linkRef: link.id })
                featureBuffer.push(linkLineFeature);

                const half = link.width / 2;
                const left = [ p1, p2 ].map(([ x, y ]) => [ x - unitNormal[0] * half, y - unitNormal[1] * half ]);
                const right = [ p2, p1 ].map(([ x, y ]) => [ x + unitNormal[0] * half, y + unitNormal[1] * half ]);
                const linkPolygon = new Polygon([ [ ...left, ...right, left[0] ] ]);
                const linkPolygonFeature = new Feature(linkPolygon)
                linkPolygonFeature.setProperties({ ...link, featureType: "link" })
                featureBuffer.push(linkPolygonFeature);

                const laneCount = link.lanes?.length ?? 1;
                for (let i = 0; i < laneCount; i++) {
                    const lane = link.lanes[i];
                    const laneWidth = lane.width ?? 3.5;
                    const offset = ((laneCount - 1) / 2 - i) * laneWidth;
                    const centerP1 = [ p1[0] + unitNormal[0] * offset, p1[1] + unitNormal[1] * offset ];
                    const centerP2 = [ p2[0] + unitNormal[0] * offset, p2[1] + unitNormal[1] * offset ];

                    const halfWidth = laneWidth / 2;
                    const outerP1 = [ centerP1[0] + unitNormal[0] * halfWidth, centerP1[1] + unitNormal[1] * halfWidth ];
                    const outerP2 = [ centerP2[0] + unitNormal[0] * halfWidth, centerP2[1] + unitNormal[1] * halfWidth ];
                    const innerP1 = [ centerP1[0] - unitNormal[0] * halfWidth, centerP1[1] - unitNormal[1] * halfWidth ];
                    const innerP2 = [ centerP2[0] - unitNormal[0] * halfWidth, centerP2[1] - unitNormal[1] * halfWidth ];

                    const laneProps = {
                        ...lane,
                        linkRef: link.id,
                        featureType: "lane",
                        length: link.length,
                        laneRef: i,
                        laneSource: centerP1,
                        laneTarget: centerP2,
                    };

                    const laneFeature = new Feature(new Polygon([ [ innerP1, innerP2, outerP2, outerP1, innerP1 ] ]));
                    laneFeature.setProperties(laneProps);
                    laneMap.set(`${ link.id }_${ lane.id }`, laneFeature);
                    featureBuffer.push(laneFeature);

                    const laneLineFeature = new Feature(new LineString([ centerP1, centerP2 ]));
                    laneLineFeature.setProperties({ ...laneProps, featureType: "lane-edit" });
                    featureBuffer.push(laneLineFeature);
                }
            }

            for (const node of nodes) {
                const [ xCoord, yCoord ] = node.center.split(" ");
                node.lng = baseLng + (xCoord / 88000);
                node.lat = baseLat + (yCoord / 111000);

                const point = new Point(fromLonLat([ node.lng, node.lat ]));
                const nodeFeature = new Feature(point);
                nodeFeature.setProperties({ ...node, featureType: "node" });
                featureBuffer.push(nodeFeature);

                if (!node.connections) continue;
                for (const conn of node.connections) {

                    const from = laneMap.get(`${ conn.fromLink }_${ conn.fromLane }`);
                    const to = laneMap.get(`${ conn.toLink }_${ conn.toLane }`);
                    if (!from || !to) continue;
                    const fromPt = from.get("laneTarget");
                    const toPt = to.get("laneSource");
                    const nodePt = fromLonLat([ node.lng, node.lat ]);
                    const bezierPoints = this.getRatioBasedBezierPoints(
                        fromPt, toPt, nodePt,
                        100,       // 점 개수
                        0.5,      // from - to 중간 지점
                        0.15       // node 방향으로 당기는 정도
                    );

                    if (!bezierPoints || bezierPoints.length < 2) continue;

                    let coord: [ number, number ][];
                    if (conn.turning === "S") {
                        coord = [ fromPt, toPt ]
                    } else {
                        coord = bezierPoints;
                    }
                    const connLine = new LineString(coord);
                    const connLineFeature = new Feature(connLine);
                    connLineFeature.setProperties({
                        ...conn,
                        featureType: "connection-edit",
                        fromNodeType: node.type,
                    });
                    featureBuffer.push(connLineFeature);
                }
            }

            this.source.clear()
            this.source.addFeatures(featureBuffer);
            console.log("NetworkLayer: 로드 완료");
        } catch (e) {
            console.error("NetworkLayer.load 에러:", e);
        }
    }

    public getSnapLayerKey(): string {
        return "network"
    }
    public getSnapFeatureType(): string {
        return "link-edit";
    }

}