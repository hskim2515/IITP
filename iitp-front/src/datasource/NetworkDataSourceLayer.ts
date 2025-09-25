import * as Cesium from "cesium";
import { GeoJsonDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Network } from "@type/Network";
import { diff } from "deep-object-diff";

export default class NetworkDataSourceLayer {
    private readonly LAYER_NAME = "network";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: (() => void) | undefined;
    private static readonly EPSILON = 1e-9;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        this.load(); // 초기 로드
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state: {currentJsonData: Network}) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load();
                },
                {equalityFn: (a: Network, b: Network) => diff(a, b) === undefined}
            );
        }
    }

    private getLineIntersectionPoint(p1: Cesium.Cartesian3, v1: Cesium.Cartesian3, p2: Cesium.Cartesian3, v2: Cesium.Cartesian3): Cesium.Cartesian3 | null {
        const p1p2 = Cesium.Cartesian3.subtract(p1, p2, new Cesium.Cartesian3());

        const v1_dot_v1 = Cesium.Cartesian3.dot(v1, v1);
        const v2_dot_v2 = Cesium.Cartesian3.dot(v2, v2);
        const v1_dot_v2 = Cesium.Cartesian3.dot(v1, v2);

        const denominator = v1_dot_v2 * v1_dot_v2 - v1_dot_v1 * v2_dot_v2;

        if (Math.abs(denominator) < NetworkDataSourceLayer.EPSILON) {
            return null;
        }

        const p1p2_dot_v1 = Cesium.Cartesian3.dot(p1p2, v1);
        const p1p2_dot_v2 = Cesium.Cartesian3.dot(p1p2, v2);

        const t = (p1p2_dot_v1 * v2_dot_v2 - p1p2_dot_v2 * v1_dot_v2) / denominator;

        return Cesium.Cartesian3.add(p1, Cesium.Cartesian3.multiplyByScalar(v1, t, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    }
    private generateQuadraticBezierCurve(
        start: Cesium.Cartesian3,
        controlPoint: Cesium.Cartesian3,
        end: Cesium.Cartesian3,
        numPoints: number = 15,
        pullScale: number = 0.9
    ): Cesium.Cartesian3[] {

        const basePoint = Cesium.Cartesian3.add(start, end, new Cesium.Cartesian3());
        Cesium.Cartesian3.multiplyByScalar(basePoint, 0.5, basePoint);

        const pullVector = Cesium.Cartesian3.subtract(controlPoint, basePoint, new Cesium.Cartesian3())
        Cesium.Cartesian3.multiplyByScalar(pullVector, pullScale, pullVector);
        const effectiveControlPoint = Cesium.Cartesian3.add(basePoint, pullVector, new Cesium.Cartesian3());

        const points: Cesium.Cartesian3[] = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const tInv = 1 - t;

            const p0_scaled = Cesium.Cartesian3.multiplyByScalar(start, tInv * tInv, new Cesium.Cartesian3());
            const p1_scaled = Cesium.Cartesian3.multiplyByScalar(effectiveControlPoint, 2 * tInv * t, new Cesium.Cartesian3());
            const p2_scaled = Cesium.Cartesian3.multiplyByScalar(end, t * t, new Cesium.Cartesian3());

            const pointOnCurve = Cesium.Cartesian3.add(p0_scaled, p1_scaled, new Cesium.Cartesian3());
            Cesium.Cartesian3.add(pointOnCurve, p2_scaled, pointOnCurve);

            points.push(pointOnCurve);
        }
        return points;
    }
    public async load(): Promise<void> {
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            const store = layerNameToStoreMap[this.LAYER_NAME];

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
                const direction = Cesium.Cartesian3.subtract(target, source, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(direction, direction);

                const offsetVec = Cesium.Cartesian3.multiplyByScalar(direction, offset, new Cesium.Cartesian3());
                const start = Cesium.Cartesian3.add(source, offsetVec, new Cesium.Cartesian3());

                const lengthVec = Cesium.Cartesian3.multiplyByScalar(direction, length, new Cesium.Cartesian3());
                const end = Cesium.Cartesian3.add(start, lengthVec, new Cesium.Cartesian3());

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

            const network: Network | undefined = store.getState().currentJsonData;
            if (!network || !network.nodes || !network.links) {
                console.log("[NetworkDataSourceLayer] No network data to load.");
                return;
            }
            const nodes = network.nodes;
            const links = network.links;

            // 링크 그리기
            for (const link of links) {
                const source = nodes.find(n => n.id == link.fromNode);
                const target = nodes.find(n => n.id == link.toNode);
                if (!source || !target || !link.lanes) continue;

                const p1 = Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat);
                const p2 = Cesium.Cartesian3.fromDegrees(link.coordinates[1].lng, link.coordinates[1].lat);

                const direction = Cesium.Cartesian3.subtract(p1, p2, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(direction, direction);

                const up = Cesium.Cartesian3.UNIT_Z;
                const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(right, right);

                this.dataSource.entities.add(new Cesium.Entity({
                    id: link.__guid,
                    corridor: {
                        cornerType: Cesium.CornerType.MITERED,
                        positions: [p1, p2],
                        width: link.width,
                        material: Cesium.Color.SILVER.withAlpha(0.8),
                        height: 0.02,
                    },
                    properties: link
                }));

                const laneCount = link.lanes.length || 2;
                const n = link.lanes.length;

                for (let i = 0; i < n; i++) {
                    const lane = link.lanes[i];
                    if(!lane) continue;
                    const laneWidth = link.width / laneCount;
                    const offset = ((laneCount - 1) / 2 - i) * laneWidth;

                    const offsetVec = Cesium.Cartesian3.multiplyByScalar(right, offset, new Cesium.Cartesian3());
                    const shiftedP1 = Cesium.Cartesian3.add(p1, offsetVec, new Cesium.Cartesian3());
                    const shiftedP2 = Cesium.Cartesian3.add(p2, offsetVec, new Cesium.Cartesian3());
                    lane.linkRef = link.id
                    lane.laneSource = shiftedP1;
                    lane.laneTarget = shiftedP2;

                    this.dataSource.entities.add({
                        id: lane.__guid,
                        corridor: {
                            cornerType: Cesium.CornerType.MITERED,
                            positions: [shiftedP1, shiftedP2],
                            width: laneWidth,
                            material: Cesium.Color.BLACK.withAlpha(0.8),
                            height: 0.03,
                        },
                        properties: lane
                    });

                    if (lane.cells?.length > 0) {
                        for (const cell of lane.cells) {
                            const corridor = createCorridorAlongLane({
                                id: cell.__guid,
                                source: lane.laneSource,
                                target: lane.laneTarget,
                                offset: cell.offset ?? 0,
                                length: cell.length ?? 5,
                                width: 0.8,
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
                        length: 5.0,
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

                    const source = Cesium.Cartesian3.fromDegrees(sourceNode.coordinates.lng, sourceNode.coordinates.lat);
                    const target = Cesium.Cartesian3.fromDegrees(targetNode.coordinates.lng, targetNode.coordinates.lat);

                    const portEntity = new Cesium.Entity({
                        id: port.__guid,
                        position: port.type == 'in' ? source : target,
                        cylinder: {
                            length: port.type == 'in' ? 2 : 2,
                            topRadius: port.type == 'in' ? 1.5 : 0.1,
                            bottomRadius: port.type == 'in' ? 0.1 : 1.5,
                            material: port.type == 'in' ? Cesium.Color.CYAN.withAlpha(0.8) : Cesium.Color.MAGENTA.withAlpha(0.8),
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        properties: port,
                    });
                    this.dataSource.entities.add(portEntity);
                }

                if (node.connections) {
                    for (const conn of node.connections) {
                        const fromLink = links.find((l) => l.id == conn.fromLink);
                        const toLink = links.find((l) => l.id == conn.toLink);
                        if (!fromLink || !toLink) continue;

                        const fromLane = fromLink.lanes?.[conn.fromLane];
                        const toLane = toLink.lanes?.[conn.toLane];
                        // Ensure laneSource/laneTarget were calculated and attached
                        if (!fromLane || !toLane || !fromLane.laneTarget || !toLane.laneSource) continue;

                        const fromPt = fromLane.laneTarget;
                        const toPt = toLane.laneSource;
                        let positions: Cesium.Cartesian3[];

                        if (conn.turning === 'Straight') {
                            positions = [fromPt, toPt];
                        } else {
                            // Calculate vectors for the parent links
                            const fromLinkP1 = Cesium.Cartesian3.fromDegrees(fromLink.coordinates[0].lng, fromLink.coordinates[0].lat);
                            const fromLinkP2 = Cesium.Cartesian3.fromDegrees(fromLink.coordinates[1].lng, fromLink.coordinates[1].lat);
                            const fromVector = Cesium.Cartesian3.subtract(fromLinkP2, fromLinkP1, new Cesium.Cartesian3());

                            const toLinkP1 = Cesium.Cartesian3.fromDegrees(toLink.coordinates[0].lng, toLink.coordinates[0].lat);
                            const toLinkP2 = Cesium.Cartesian3.fromDegrees(toLink.coordinates[1].lng, toLink.coordinates[1].lat);
                            const toVector = Cesium.Cartesian3.subtract(toLinkP2, toLinkP1, new Cesium.Cartesian3());

                            // Find the intersection point to use as a Bezier control point
                            const controlPoint = this.getLineIntersectionPoint(fromPt, fromVector, toPt, toVector);

                            if (controlPoint) {
                                positions = this.generateQuadraticBezierCurve(fromPt, controlPoint, toPt);
                            } else {
                                // Fallback for parallel lines
                                positions = [fromPt, toPt];
                            }
                        }

                        this.dataSource.entities.add({
                            id: conn.__guid,
                            polyline: {
                                positions: positions,
                                width: 5,
                                material: new Cesium.PolylineArrowMaterialProperty(
                                    Cesium.Color.WHITE.withAlpha(0.8)
                                ),
                                clampToGround: true, // Assuming connections should be clamped
                            },
                            properties: conn
                        });
                    }
                }
            }

            const response = await fetch(process.env.VITE_API_URL + "/signal", {
                method: "GET",
                headers: {"Content-Type": "application/json"},
            });
            const {nodes: signalNodes} = await response.json();

            signalNodes?.forEach(node => {
                node.turns.forEach(turn => {
                    turn.connList.forEach(connId => {
                        const targetNode = nodes.find(t => t.id == node.id);
                        const conn = this.findConnectionById(targetNode, connId);
                        if (!conn) return;
                        // ... Signal related entity logic ...
                    });
                });
            });

            console.log("NetworkDataSourceLayer: 모든 Feature가 추가됨");
        } catch (error) {
            console.error("NetworkDataSourceLayer.load() 중 에러 발생:", error);
        } finally {
            this.dataSource.entities.resumeEvents();
        }
    }

    private findConnectionById = (node, connId) => {
        return node?.connections?.find(conn => conn.id == connId);
    }

    public destroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.dataSource) {
            this.viewer.dataSources.remove(this.dataSource, true);
        }
    }
}