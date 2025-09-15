import { GeoJsonDataSource, Viewer } from "cesium";
import * as Cesium from "cesium";
import {layerNameToStoreMap, menuCodeToStoreMap} from "@hooks/useLayerInit";
import {useScenarioStore} from "@stores/useScenarioStore";
import { Network } from "@type/Network";
import { fromLonLat } from "ol/proj";

export default class NetworkDataSourceLayer {
    private readonly LAYER_NAME = "network";
    private dataSource: GeoJsonDataSource | undefined;
    private selectedScenario = useScenarioStore.getState().selectedScenario

    constructor(private viewer: Viewer) {
        this.load()
    }

    public async load(): Promise<GeoJsonDataSource | undefined> {

        const store = layerNameToStoreMap[this.LAYER_NAME]
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const createCorridorAlongLane = ({
                                             id,
                                             source,
                                             target,
                                             offset = 0,
                                             length = 5,
                                             width = 1,
                                             material,
                                             properties,
                                         }) => {
            // 1. 방향 벡터 계산
            const direction = Cesium.Cartesian3.subtract(target, source, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(direction, direction);

            // 2. offset 지점 계산 (source에서 direction으로 offset만큼 이동)
            const offsetVec = Cesium.Cartesian3.multiplyByScalar(direction, offset, new Cesium.Cartesian3());
            const start = Cesium.Cartesian3.add(source, offsetVec, new Cesium.Cartesian3());

            // 3. length 지점 계산 (offset 지점에서 direction으로 length만큼 이동)
            const lengthVec = Cesium.Cartesian3.multiplyByScalar(direction, length, new Cesium.Cartesian3());
            const end = Cesium.Cartesian3.add(start, lengthVec, new Cesium.Cartesian3());

            // 4. Corridor 생성
            return new Cesium.Entity({
                id,
                corridor: {
                    positions: [start, end],
                    width,
                    height: 0.05,
                    material,
                    cornerType: Cesium.CornerType.MITERED,
                },
                properties,
            });
        };


        try {

            const network: Network | undefined = store.getState().originData;
            if (!network) return;
            const nodes = network.nodes;
            const links = network.links;


            // 링크 그리기
            for (const link of links) {

                const source = nodes.find(n => n.id == link.fromNode);
                const target = nodes.find(n => n.id == link.toNode);
                if (!source || !target || !link.lanes) continue;

                // WGS84 좌표 → Cartesian3
                const p1 = Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat);
                const p2 = Cesium.Cartesian3.fromDegrees(link.coordinates[1].lng, link.coordinates[1].lat);

                // 방향 벡터 계산 (ENU 상)
                const direction = Cesium.Cartesian3.subtract(p1, p2, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(direction, direction);

                // 수직 벡터 계산 (ENU 평면에서 Z 제외한 수직 벡터)
                const up = Cesium.Cartesian3.UNIT_Z;
                const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(right, right);

                this.dataSource.entities.add(new Cesium.Entity({
                    id: link.__guid,
                    corridor: {
                        cornerType: Cesium.CornerType.MITERED,
                        positions: [p1, p2],
                        width: link.width, // 레인별 폭 적용
                        material: Cesium.Color.SILVER.withAlpha(0.8),
                        height: 0.02,
                    },
                    properties:link
                }));

                const laneCount = link.lanes.length || 2; // 차선 수

                const n = link.lanes.length;

                for (let i = 0; i < n; i++) {
                    const lane = link.lanes[i];
                    const laneWidth = link.width/laneCount;
                    const offset = ((laneCount - 1) / 2 - i) * laneWidth;
                    //const offset = ((laneCount - 1) / 2 - i) * laneWidth;

                    // 방향 벡터에서 수직 방향(right)을 따라 offset 벡터 계산
                    const offsetVec = Cesium.Cartesian3.multiplyByScalar(right, offset, new Cesium.Cartesian3());

                    // 평행이동된 좌표 생성
                    const shiftedP1 = Cesium.Cartesian3.add(p1, offsetVec, new Cesium.Cartesian3());
                    const shiftedP2 = Cesium.Cartesian3.add(p2, offsetVec, new Cesium.Cartesian3());

                    // const [firstPointStr, lastPointStr] = lane.shape.split(" ");
                    // const [x1, y1] = firstPointStr.split(",").map(parseFloat);
                    // const [x2, y2] = lastPointStr.split(",").map(parseFloat);
                    //
                    // const sourceCart = Cesium.Cartesian3.fromDegrees(baseLng + x1/ 88000, baseLat + y1/ 111000);
                    // const targetCart = Cesium.Cartesian3.fromDegrees(baseLng + x2/ 88000, baseLat + y2/ 111000);

                    lane.laneSource = shiftedP1;
                    lane.laneTarget = shiftedP2;

                    this.dataSource.entities.add({
                        id: lane.__guid,
                        corridor: {
                            cornerType: Cesium.CornerType.MITERED,
                            positions: [shiftedP1, shiftedP2],
                            width: laneWidth, // 레인별 폭 적용
                            material: Cesium.Color.BLACK.withAlpha(0.8),
                            height: 0.03,
                        },
                        properties: link.lanes[i]
                    });

                    if (lane.cells?.length > 0) {
                        for (const cell of lane.cells) {
                            const corridor = createCorridorAlongLane({
                                id: cell.__guid,
                                source: lane.laneSource,
                                target: lane.laneTarget,
                                offset: cell.offset ?? 0,
                                length: cell.length ?? 5,
                                width: 0.8, // 임의의 cell 폭
                                material: Cesium.Color.RED.withAlpha(0.6),
                                properties: cell,
                            });
                            this.dataSource.entities.add(corridor);
                        }
                    }

                    if (lane.segments?.length > 0) {
                        for (const segment of lane.segments) {
                            const corridor = createCorridorAlongLane({
                                id: segment.__guid,
                                source: lane.laneSource,
                                target: lane.laneTarget,
                                offset: segment.initPoint ?? 0,
                                length: (segment.endPoint ?? 0) - (segment.initPoint ?? 0),
                                width: 1.5,
                                material: segment.block
                                    ? Cesium.Color.YELLOW.withAlpha(0.8)
                                    : Cesium.Color.BLUE.withAlpha(0.5),
                                properties: segment,
                            });
                            this.dataSource.entities.add(corridor);
                        }
                    }
                }
            }

            for (const node of nodes) {

                const position = Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat);

                const nodeEntity = new Cesium.Entity({
                    id: node.__guid,
                    position,
                    cylinder: {
                        length: 5.0, // 높이
                        topRadius: 0.5,
                        bottomRadius: 0.5,
                        material: Cesium.Color.YELLOW,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    },

                    properties: node,
                });

                this.dataSource.entities.add(nodeEntity);

                for (const port of node.ports) {
                    const link = links.find((l) => l.id == port.linkId);
                    if (!link) continue;

                    const sourceNode = nodes.find((n) => n.id == link.fromNode);
                    const targetNode = nodes.find((n) => n.id == link.toNode);
                    if (!sourceNode || !targetNode) continue;

                    // 링크 중심 위치 (혹은 시작에서 offset 위치도 가능)
                    const source = Cesium.Cartesian3.fromDegrees(sourceNode.coordinates.lng, sourceNode.coordinates.lat);
                    const target = Cesium.Cartesian3.fromDegrees(targetNode.coordinates.lng, targetNode.coordinates.lat);

                    const portEntity = new Cesium.Entity({
                        id: port.__guid,
                        position:  port.type == 'in' ? source : target,
                        cylinder: {
                            length: port.type == 'in' ? 2 : 2, // 높이
                            topRadius: port.type == 'in' ? 1.5 : 0.1,
                            bottomRadius: port.type == 'in' ? 0.1 : 1.5,
                            material: port.type == 'in' ? Cesium.Color.CYAN.withAlpha(0.8) : Cesium.Color.MAGENTA.withAlpha(0.8),
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        properties: port,
                    });

                    this.dataSource.entities.add(portEntity);
                }

                const connections = node.connections

                if (connections) {
                    for (const conn of node.connections || []) {
                        const [x1, y1] = [conn.coordinates[0].lng, conn.coordinates[0].lat];
                        const [x2, y2] = [conn.coordinates[1].lng, conn.coordinates[1].lat];

                        const sourceCart = Cesium.Cartesian3.fromDegrees(x1, y1);
                        const targetCart = Cesium.Cartesian3.fromDegrees(x2, y2);

                        const fromLink = links.find((l) => l.id == conn.fromLink);
                        const toLink = links.find((l) => l.id == conn.toLink);

                        if (!fromLink || !toLink) continue;

                        const fromLane = fromLink.lanes[conn.fromLane];
                        const toLane = toLink.lanes[conn.toLane];

                        if (!fromLane || !toLane) continue;

                        const position = [fromLane.laneTarget]

                        if(conn.turning != 'S'){

                            const nodeLon = node.coordinates.lng;
                            const nodeLat = node.coordinates.lat;
                            const nodeHeight = 0;
                            const nodePos = Cesium.Cartesian3.fromDegrees(nodeLon, nodeLat, nodeHeight);

                            const midpoint = Cesium.Cartesian3.midpoint(fromLane.laneTarget, toLane.laneSource, new Cesium.Cartesian3());

                            const direction = Cesium.Cartesian3.subtract(nodePos, midpoint, new Cesium.Cartesian3());

                            Cesium.Cartesian3.multiplyByScalar(direction, 1 / 10, direction);

                            const adjustedMid = Cesium.Cartesian3.add(midpoint, direction, new Cesium.Cartesian3());

                            //position.push(adjustedMid)
                            const points = [fromLane.laneTarget, adjustedMid, toLane.laneSource]

                            const spline = new Cesium.CatmullRomSpline({
                                times: [0.0, 0.5, 1.0],
                                points
                            });

                            for (let i = 0; i <= 10; i++) {
                                position.push(spline.evaluate(i / 10));
                            }
                        }

                        position.push(toLane.laneSource)

                        this.dataSource.entities.add({
                            id: conn.__guid,
                            polyline: {
                                positions: position,
                                width: 5,
                                arcType: Cesium.ArcType.GEODESIC,
                                material: new Cesium.PolylineArrowMaterialProperty(
                                    Cesium.Color.WHITE.withAlpha(0.8)
                                ),
                                clampToGround: true,
                            },
                            properties: conn
                        });
                    }
                }
            }
            console.log(this.selectedScenario)
            fetch(process.env.VITE_API_URL + "/signal/" + this.selectedScenario.key, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            })
                .then((response) => {
                    return response.json();
                })
                .then(({nodes : signalNodes}) => {
                    signalNodes?.forEach(node => {
                        node.turns.forEach(turn => {
                            turn.connList.forEach(connId => {
                                const targetNode = nodes.find(t => t.id == node.id)
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
        return node.connections?.find(conn => conn.id == connId);
    }

}
