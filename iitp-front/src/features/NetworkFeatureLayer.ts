import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useLayerStore } from "@stores/useLayerStore";
import { Feature } from "ol";
import { Circle as CircleStyle, Fill, Stroke, Style, } from "ol/style";
import { LineString, Point, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Coordinate } from "ol/coordinate";
import { Network } from "@type/Network";
import { getTriangleConnectionPoints } from "@utils/network";
import { FeatureLike } from "ol/Feature";

export default class NetworkFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "network"

    private static readonly BEZIER_POINTS = 15;
    private styleCache: Map<string, Style[]> = new Map();

    private unsubscribe: () => void;

    private zIndexMap: Record<string, number> = {
        "link": 10,
        "link-edit": 110,
        "lane": 20,
        "lane-edit": 120,
        "connection": 30,
        "connection-edit": 130,
        "node": 150,
        "port": 160
    };

    private static readonly BASE_STYLES = {
        LINK: new Style({
            fill: new Fill({ color: "#000000" }),
            zIndex: 10
        }),
        LANE: new Style({
            fill: new Fill({ color: "#7f7f7f" }),
            stroke: new Stroke({ color: "#ffffff", width: 2 }),
            zIndex: 20
        }),
        CONNECTION: new Style({
            fill: new Fill({ color: "rgba(0,0,0,0.3)" }),
            zIndex: 30
        }),
        NODE_POINT: new Style({
            image: new CircleStyle({
                radius: 3,
                fill: new Fill({ color: "rgba(255, 255, 0, 1)" }),
                stroke: new Stroke({ color: "rgba(0, 0, 0, 1)", width: 2 }),
            }),
            zIndex: 150
        })
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

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
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
        //         image: new CircleStyle({
        //             radius: 3,
        //             fill: new Fill({color: "rgba(255, 255, 0, 1)"}), // 노란색
        //             stroke: new Stroke({color: "rgba(0, 0, 0, 1)", width: 2}),
        //         }),
        //         zIndex
        //     }));
        // }
        if (geom instanceof Point && props.featureType === "port") {
            // if(props.type === 'in') {
            //     styles.push(new Style({
            //         image: new RegularShape({
            //             fill: new Fill({ color: 'rgba(0,255,255,0.8)' }),
            //             stroke: new Stroke({ color: 'rgba(0,128,128,1)' }),
            //             points: 3,
            //             radius: 8,
            //             angle: Math.PI / 2
            //         }),
            //         zIndex: zIndex + 1
            //     }))
            // } else if (props.type === 'out') {
            //     styles.push(new Style({
            //         image: new RegularShape({
            //             fill: new Fill({ color: 'rgba(255, 0,255,0.8)' }),
            //             stroke: new Stroke({ color: 'rgba(128, 0,128,1)' }),
            //             points: 3,
            //             radius: 10,
            //             angle: Math.PI / 4
            //         }),
            //         zIndex
            //     }))
            // }
        }
        return styles;
    }

    /**
     * 세 점(시작, 제어, 끝)을 이용해 2차 베지에 곡선을 생성합니다.
     * pullScale을 통해 곡률을 조정할 수 있습니다.
     * @param from 시작점
     * @param p3 제어점 (삼각형의 교점)
     * @param to 끝점
     * @param numberOfPoints 곡선의 부드러움을 결정하는 점의 개수
     * @param pullScale 곡선을 제어점으로 당기는 강도 (0: 직선, 1: 최대 곡률)
     * @returns 곡선을 구성하는 좌표 배열
     */
    private generateQuadraticBezierCurve(
        from: Coordinate,
        p3: Coordinate,
        to: Coordinate,
        numberOfPoints: number = 15,
        pullScale: number = 0.9 // 기본값을 70% 정도로 설정
    ): Coordinate[] {
        // 1. 'from'과 'to'를 잇는 직선 위의 기준점(여기서는 중점)을 계산합니다.
        // 이 점이 pullScale이 0일 때의 제어점 위치가 됩니다.
        const basePoint: Coordinate = [
            (from[0] + to[0]) / 2,
            (from[1] + to[1]) / 2,
        ];

        // 2. pullScale을 이용해 실제 사용할 제어점(effectiveControlPoint)의 위치를 보간(interpolate)합니다.
        // basePoint에서 p3 방향으로 pullScale 비율만큼 이동시킵니다.
        const effectiveControlPoint: Coordinate = [
            basePoint[0] + (p3[0] - basePoint[0]) * pullScale,
            basePoint[1] + (p3[1] - basePoint[1]) * pullScale,
        ];

        const curvePoints: Coordinate[] = [];
        for (let i = 0; i <= numberOfPoints; i++) {
            const t = i / numberOfPoints;
            const tInv = 1 - t;

            // 3. 계산된 effectiveControlPoint를 베지에 곡선 공식에 사용합니다.
            const x = (tInv ** 2) * from[0] + 2 * tInv * t * effectiveControlPoint[0] + (t ** 2) * to[0];
            const y = (tInv ** 2) * from[1] + 2 * tInv * t * effectiveControlPoint[1] + (t ** 2) * to[1];

            curvePoints.push([x, y]);
        }
        return curvePoints;
    }

    public async load(): Promise<void> {

        const store = layerNameToStoreMap[this.LAYER_NAME];

        try {
            const network: Network | undefined = store.getState().originData;
            if (!network) return;
            const nodes = network.nodes;
            const links = network.links;

            const featureBuffer: Feature[] = [];
            const laneMap = new Map<string | number, Feature>();
            const linkMap = new Map<string | number, any>();

            for (const link of links) {
                linkMap.set(link.id, link);

                const p1 = fromLonLat([ link.coordinates[0].lng, link.coordinates[0].lat ]);
                const p2 = fromLonLat([ link.coordinates[1].lng, link.coordinates[1].lat ]);

                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const len = Math.hypot(dx, dy);
                const unitNormal: [ number, number ] = len > 0 ? [ -dy / len, dx / len ] : [ 0, 0 ];

                const linkLine = new LineString([ p1, p2 ]);
                const linkLineFeature = new Feature(linkLine);
                linkLineFeature.setProperties({ ...link, featureType: "link-edit", linkRef: link.id });
                featureBuffer.push(linkLineFeature);

                const half = link.width / 2;
                const left = [ p1, p2 ].map(([ x, y ]) => [ x - unitNormal[0] * half, y - unitNormal[1] * half ]);
                const right = [ p2, p1 ].map(([ x, y ]) => [ x + unitNormal[0] * half, y + unitNormal[1] * half ]);
                const linkPolygon = new Polygon([ [ ...left, ...right, left[0] ] ]);
                const linkPolygonFeature = new Feature(linkPolygon);
                linkPolygonFeature.setProperties({ ...link, featureType: "link" });
                featureBuffer.push(linkPolygonFeature);

                const laneCount = link.lanes?.length ?? 2;
                for (let i = 0; i < laneCount; i++) {
                    const lane = link.lanes[i];
                    const laneWidth = 3.5; // lane.width 부재
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
                    if (lane.cells?.length > 0) {
                        for (const cell of lane.cells) {
                            // const cooridor = createCorridorAlongLane({
                            //     id: cell.__guid,
                            //     so
                            // })
                        }
                    }
                }
            }

            for (const node of nodes) {

                const nodePt = fromLonLat([ node.coordinates.lng, node.coordinates.lat ]);

                const point = new Point(nodePt);
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

                    let coord: Coordinate[];
                    if (conn.turning === "Straight") {
                        coord = [ fromPt, toPt ];
                    } else {
                        const fromLink = linkMap.get(conn.fromLink);
                        const toLink = linkMap.get(conn.toLink);

                        if (!fromLink || !toLink) {
                            coord = [ fromPt, toPt ];
                        } else {
                            const fromLinkP1 = fromLonLat([ fromLink.coordinates[0].lng, fromLink.coordinates[0].lat ]);
                            const fromLinkP2 = fromLonLat([ fromLink.coordinates[1].lng, fromLink.coordinates[1].lat ]);
                            const fromVector = [ fromLinkP2[0] - fromLinkP1[0], fromLinkP2[1] - fromLinkP1[1] ];

                            const toLinkP1 = fromLonLat([ toLink.coordinates[0].lng, toLink.coordinates[0].lat ]);
                            const toLinkP2 = fromLonLat([ toLink.coordinates[1].lng, toLink.coordinates[1].lat ]);
                            const toVector = [ toLinkP2[0] - toLinkP1[0], toLinkP2[1] - toLinkP1[1] ];

                            const triangleVertices = getTriangleConnectionPoints(fromPt, toPt, fromVector, toVector);

                            if (triangleVertices) {
                                const [p1, p3, p2] = triangleVertices;
                                coord = this.generateQuadraticBezierCurve(fromPt, p3, toPt);
                            } else {
                                coord = [ fromPt, toPt ];
                            }
                        }
                    }

                    if (!coord || coord.length < 2) continue;

                    const connLine = new LineString(coord);
                    const connLineFeature = new Feature(connLine);
                    connLineFeature.setProperties({
                        ...conn,
                        featureType: "connection-edit",
                        fromNodeType: node.type,
                        nodeId: node.id,
                    });
                    featureBuffer.push(connLineFeature);
                }

                if (!node.ports) continue;
                for (const port of node.ports) {
                    const link = links.find((l) => l.id == port.linkId);
                    if (!link) continue;

                    const sourceNode = nodes.find((n) => n.id == link.fromNode);
                    const targetNode = nodes.find((n) => n.id == link.toNode);
                    if (!sourceNode || !targetNode) continue;

                    const source = fromLonLat([sourceNode.coordinates.lng, sourceNode.coordinates.lat]);
                    const target = fromLonLat([targetNode.coordinates.lng, targetNode.coordinates.lat]);

                    const position = port.type === 'in' ? source : target;

                    const portFeature = new Feature({
                        ...port,
                        geometry: new Point(position),
                        featureType: "port",
                    });
                    featureBuffer.push(portFeature);
                }
            }

            this.source.clear();
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
    public getConnectionFeatureType(): string {
        return "connection-edit";
    }
}