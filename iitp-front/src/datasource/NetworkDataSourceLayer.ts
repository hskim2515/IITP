import { GeoJsonDataSource, Viewer } from "cesium";
import * as Cesium from "cesium";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {useScenarioStore} from "@stores/useScenarioStore";

export default class NetworkDataSourceLayer {
    private readonly LAYER_NAME = "NETWORK";
    private dataSource: GeoJsonDataSource;

    constructor(private viewer: Viewer) {
        this.load()
    }

    public async load(): Promise<GeoJsonDataSource> {

        const store = menuCodeToStoreMap[this.LAYER_NAME]
        const selectedScenario = useScenarioStore.getState().selectedScenario;
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        try {

            const { nodes, links, lanes, cells, segments } = store.getState().originData;
            const baseLng = selectedScenario.longitude;
            const baseLat = selectedScenario.latitude;

            nodes.forEach(node => {
                const [xCoord, yCoord] = node.center.split(" ");
                node.lng = baseLng + (xCoord/ 88000);
                node.lat = baseLat + (yCoord/ 111000);
            });

            // 링크 그리기
            for (const link of links) {
                const [firstPointStr, lastPointStr] = link.shape.split(" ");
                const [x1, y1] = firstPointStr.split(",").map(parseFloat);
                const [x2, y2] = lastPointStr.split(",").map(parseFloat);

                const source = nodes.find(n => n.id === link.fromNode);
                const target = nodes.find(n => n.id === link.toNode);
                if (!source || !target || !link.lanes) continue;

                // WGS84 좌표 → Cartesian3
                const sourceCart = Cesium.Cartesian3.fromDegrees(baseLng + x1/ 88000, baseLat + y1/ 111000);
                const targetCart = Cesium.Cartesian3.fromDegrees(baseLng + x2/ 88000, baseLat + y2/ 111000);

                // 방향 벡터 계산 (ENU 상)
                const direction = Cesium.Cartesian3.subtract(targetCart, sourceCart, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(direction, direction);

                // 수직 벡터 계산 (ENU 평면에서 Z 제외한 수직 벡터)
                const up = Cesium.Cartesian3.UNIT_Z;
                const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(right, right);

                this.dataSource.entities.add(new Cesium.Entity({
                    corridor: {
                        cornerType: Cesium.CornerType.MITERED,
                        positions: [sourceCart, targetCart],
                        width: link.width, // 레인별 폭 적용
                        material: Cesium.Color.WHITE,
                        height: 0.02,
                    },
                    properties:link
                }));

                const laneCount = link.lanes.length || 2; // 차선 수

                const n = link.lanes.length;

                for (let i = 0; i < n; i++) {
                    const lane = link.lanes[i];

                    const [firstPointStr, lastPointStr] = lane.shape.split(" ");
                    const [x1, y1] = firstPointStr.split(",").map(parseFloat);
                    const [x2, y2] = lastPointStr.split(",").map(parseFloat);

                    const sourceCart = Cesium.Cartesian3.fromDegrees(baseLng + x1/ 88000, baseLat + y1/ 111000);
                    const targetCart = Cesium.Cartesian3.fromDegrees(baseLng + x2/ 88000, baseLat + y2/ 111000);

                    lane.laneSource = sourceCart;
                    lane.laneTarget = targetCart;

                    this.dataSource.entities.add({
                        corridor: {
                            cornerType: Cesium.CornerType.MITERED,
                            positions: [sourceCart, targetCart],
                            width: (link.width / laneCount) - 0.05, // 레인별 폭 적용
                            material: Cesium.Color.GREY.withAlpha(0.8),
                            height: 0.03,
                        },
                        properties: link.lanes[i]
                    });
                }
            }

            for (const node of nodes) {

                const connections = node.connections

                if (connections) {
                    for (const conn of node.connections || []) {
                        const [firstPointStr, lastPointStr] = conn.shape.split(" ");
                        const [x1, y1] = firstPointStr.split(",").map(parseFloat);
                        const [x2, y2] = lastPointStr.split(",").map(parseFloat);

                        const sourceCart = Cesium.Cartesian3.fromDegrees(baseLng + x1/ 88000, baseLat + y1/ 111000);
                        const targetCart = Cesium.Cartesian3.fromDegrees(baseLng + x2/ 88000, baseLat + y2/ 111000);

                        const position = [sourceCart]


                        if(conn.turning != 'S'){

                            const nodeLon = node.lng;
                            const nodeLat = node.lat;
                            const nodeHeight = 0;
                            const nodePos = Cesium.Cartesian3.fromDegrees(nodeLon, nodeLat, nodeHeight);

                            const midpoint = Cesium.Cartesian3.midpoint(sourceCart, targetCart, new Cesium.Cartesian3());

                            const direction = Cesium.Cartesian3.subtract(nodePos, midpoint, new Cesium.Cartesian3());

                            Cesium.Cartesian3.multiplyByScalar(direction, 1 / 10, direction);

                            const adjustedMid = Cesium.Cartesian3.add(midpoint, direction, new Cesium.Cartesian3());

                            //position.push(adjustedMid)
                            const points = [sourceCart, adjustedMid, targetCart]

                            const spline = new Cesium.CatmullRomSpline({
                                times: [0.0, 0.5, 1.0],
                                points
                            });

                            for (let i = 0; i <= 10; i++) {
                                position.push(spline.evaluate(i / 10));
                            }
                        }

                        position.push(targetCart)

                        this.dataSource.entities.add({
                            polyline: {
                                positions: position,
                                width: 5,
                                arcType: Cesium.ArcType.GEODESIC,
                                material: new Cesium.PolylineArrowMaterialProperty(
                                    Cesium.Color.WHITE.withAlpha(0.8)
                                ),
                                clampToGround: true,
                            },
                        });

                        conn.from = sourceCart
                        conn.to = targetCart
                    }
                }
            }

            fetch(process.env.VITE_API_URL + "/signal", {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            })
                .then((response) => {
                    return response.json();
                })
                .then(({nodes : signalNodes}) => {
                    signalNodes.forEach(node => {
                        node.turns.forEach(turn => {
                            turn.connList.forEach(connId => {
                                const targetNode = nodes.find(t => t.id === node.id)
                                const conn = this.findConnectionById(targetNode, connId); // conn에서 from → to 좌표 구함
                                if (!conn) return;

                            });
                        });
                    });

                })

            this.viewer.dataSources.add(this.dataSource);
            return this.dataSource;

            console.log("NetworkDataSourceLayer: 모든 Feature가 추가됨");
        } catch (error) {
            console.error("NetworkDataSourceLayer.load() 중 에러 발생:", error);
        }
    }

    private findConnectionById = (node, connId) => {
        return node.connections?.find(conn => conn.id === connId);
    }

}
