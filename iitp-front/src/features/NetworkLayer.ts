import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useLayerStore } from "@stores/useLayerStore";
import { Feature } from "ol";
import {
    Fill,
    Stroke,
    Style,
    Circle as CircleStyle,
    RegularShape,
} from "ol/style";
import { LineString, Point, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";

export default class NetworkLayer extends VectorLayer {
    public readonly source: VectorSource;

    constructor() {
        // LayerStore에서 활성화된 레이어 이름(필요 시 visible 제어)
        const layerStore = useLayerStore.getState();
        const activeLayerName = layerStore.activeLayerName;
        // const isVisible = activeLayerName?.includes("network") ?? false;

        // 1) VectorSource 생성
        const source = new VectorSource();

        // 2) VectorLayer(super) 생성 시 styleFunction 지정
        super({
            source,
            visible: true,
            style: (feature) => this.styleFunction(feature),
            zIndex: 300,
        });

        this.source = source;
    }

    private styleFunction(feature: Feature): Style[] {
        const props = feature.get("properties") as any;
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        // 1) laneBoundary(차선 경계) 피처: 흰색 점선
        if (props?.featureType === "laneBoundary" && geom instanceof LineString) {
            styles.push(
                new Style({
                    stroke: new Stroke({
                        color: "#ffffff",
                        width: 1.5,
                        lineDash: [8, 8],
                        lineDashOffset: 0,
                    }),
                })
            );
            return styles;
        }

        // Link Polygon
        if (geom instanceof Polygon && props?.shape) {
            styles.push(
                new Style({
                    fill: new Fill({
                        color: "#888888", // 짙은 회색
                    }),
                    stroke: new Stroke({
                        color: "#888888", // 테두리도 회색 (필요 시 width를 0으로)
                        width: 0.5,
                    }),
                })
            );
            return styles;
        }

        // Connection
        if (
            geom instanceof Polygon &&
            props?.fromLink !== undefined &&
            props?.toLink !== undefined &&
            props?.arrowStart !== undefined &&
            props?.arrowEnd !== undefined
        ) {
            // (a) 회색 면 Polygon 스타일
            const connSurfaceStyle = new Style({
                fill: new Fill({
                    color: "#888888",
                }),
                stroke: new Stroke({
                    color: "#888888",
                    width: 0.5,
                }),
            });
            styles.push(connSurfaceStyle);

            // (b) 화살표(삼각형) 스타일
            const [startX, startY] = props.arrowStart as [number, number];
            const [endX, endY] = props.arrowEnd as [number, number];
            const dx = endX - startX;
            const dy = endY - startY;
            const angle = Math.atan2(dy, dx);

            // 화살표 위치: end 지점
            const arrowPointGeom = new Point([endX, endY]);
            const arrowStyle = new Style({
                geometry: arrowPointGeom,
                image: new RegularShape({
                    fill: new Fill({ color: "#444444" }), // 어두운 회색
                    stroke: new Stroke({ color: "#444444", width: 0.5 }),
                    points: 3, // 삼각형
                    radius: 4, // 화살표 크기(px)
                    rotation: angle,
                    rotateWithView: true,
                }),
            });
            styles.push(arrowStyle);

            return styles;
        }

        // Node
        // if (geom instanceof Point && props?.id !== undefined) {
        //     styles.push(
        //         new Style({
        //             image: new CircleStyle({
        //                 radius: 4,
        //                 fill: new Fill({ color: "orange" }),
        //                 stroke: new Stroke({ color: "#ffffff", width: 1 }),
        //             }),
        //         })
        //     );
        //     return styles;
        // }

        // 기타: 보이지 않음
        return styles;
    }

    /**
     * 네트워크 데이터를 fetch하여 VectorSource에 Feature로 추가
     * - 도로(Link) 면(Polygon) 생성
     * - 차선 경계(LineString) 생성
     * - Connection(회전 경로) 면(Polygon) + 화살표용 start/end 좌표 저장
     * - Node(Point) 생성
     */
    public async load(): Promise<void> {
        console.log("NetworkLayer.load() 호출됨");

        const url = process.env.VITE_API_URL + "/network";
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });
            const { nodes, links, lanes, cells, segments } = await response.json();

            // Nodes 좌표 계산 (WGS84 → EPSG:3857)
            const baseLng = 126.7325;
            const baseLat = 37.4928;
            const scaleX = 1 / 88000;
            const scaleY = 1 / 111000;

            nodes.forEach((node: any) => {
                node.lng = baseLng + node.xCoord * scaleX;
                node.lat = baseLat + node.yCoord * scaleY;
            });

            // Link(도로) 면(Polygon) 및 차선 경계(LineString) 생성
            for (const link of links) {
                if (!link.shape) continue;

                // 2-1) 원본 shape WGS84 좌표 배열 생성
                const lonlatCoords: [number, number][] = link.shape
                    .split(" ")
                    .map((pt: string) => {
                        const [xRaw, yRaw] = pt.split(",").map(parseFloat);
                        const lon = baseLng + xRaw * scaleX;
                        const lat = baseLat + yRaw * scaleY;
                        return [lon, lat];
                    });

                // EPSG:3857 좌표 변환 (도로 중심선용)
                const centerLineCoordsProj: [number, number][] = lonlatCoords.map(
                    ([lon, lat]) => fromLonLat([lon, lat]) as [number, number]
                );
                // 중심선(LineString) 생성
                const centerLineGeom = new LineString(centerLineCoordsProj);

                // 도로 폭 및 단위 법선 벡터(unitNormal) 계산
                const lanesCount = Array.isArray(link.lanes) ? link.lanes.length : 1;
                const totalRoadWidthMeters = link.width || 4; // m
                const halfWidthMeters = totalRoadWidthMeters / 2;

                // 첫 두 점으로 부터 direction 벡터 계산 → unitNormal
                let unitNormal: [number, number] = [0, 0];
                if (centerLineCoordsProj.length >= 2) {
                    const [x0, y0] = centerLineCoordsProj[0];
                    const [x1, y1] = centerLineCoordsProj[1];
                    const dx = x1 - x0;
                    const dy = y1 - y0;
                    const len = Math.hypot(dx, dy);
                    if (len > 0) {
                        unitNormal = [-dy / len, dx / len];
                    }
                }

                // 도로 면(Polygon) 좌표 생성
                const leftOffsets: [number, number][] = [];
                const rightOffsets: [number, number][] = [];

                for (const [x, y] of centerLineCoordsProj) {
                    // 왼쪽: -halfWidth * unitNormal
                    leftOffsets.push([
                        x + unitNormal[0] * -halfWidthMeters,
                        y + unitNormal[1] * -halfWidthMeters,
                    ]);
                    // 오른쪽: +halfWidth * unitNormal
                    rightOffsets.push([
                        x + unitNormal[0] * halfWidthMeters,
                        y + unitNormal[1] * halfWidthMeters,
                    ]);
                }

                // Polygon 좌표는: 왼쪽 오프셋(정방향) + 오른쪽 오프셋(역방향) + 닫힌 궤적
                const polygonCoords: [number, number][] = [
                    ...leftOffsets,
                    ...rightOffsets.slice().reverse(),
                    leftOffsets[0],
                ];

                // 도로 면 Polygon 생성 및 Feature 추가
                const roadPolygonGeom = new Polygon([polygonCoords]);
                const roadPolyFeature = new Feature({
                    geometry: roadPolygonGeom,
                });
                roadPolyFeature.set("properties", link);
                this.source.addFeature(roadPolyFeature);

                // 차선 경계(LineString) 생성
                const laneWidthMeter = totalRoadWidthMeters / Math.max(lanesCount, 1);
                for (let i = 1; i < lanesCount; i++) {
                    // offsetDist: 도로 왼쪽(-halfWidth)에서 i * laneWidth 만큼 이동
                    const offsetDist = -halfWidthMeters + i * laneWidthMeter;
                    const boundaryCoords: [number, number][] =
                        centerLineCoordsProj.map(([x, y]) => [
                            x + unitNormal[0] * offsetDist,
                            y + unitNormal[1] * offsetDist,
                        ]);

                    const boundaryLineGeom = new LineString(boundaryCoords);
                    const boundaryFeature = new Feature({
                        geometry: boundaryLineGeom,
                    });
                    boundaryFeature.set("properties", {
                        featureType: "laneBoundary",
                    });
                    this.source.addFeature(boundaryFeature);
                }

                // Connection 계산을 위해 endpoints(start/end) 저장
                //    → Connection 로직에서 사용될 좌표들
                if (centerLineCoordsProj.length >= 2) {
                    roadPolyFeature.set("endpoints", {
                        start: centerLineCoordsProj[0],
                        end: centerLineCoordsProj[centerLineCoordsProj.length - 1],
                    });
                }
            }

            // Connection(회전 경로) 생성 (Polygon + 화살표 좌표 설정)
            for (const node of nodes) {
                if (!node.connections) continue;

                for (const conn of node.connections) {
                    const fromLinkObj = links.find((l: any) => l.id === conn.fromLink);
                    const toLinkObj = links.find((l: any) => l.id === conn.toLink);
                    if (!fromLinkObj || !toLinkObj) continue;

                    // VectorSource에서 원본 Link Feature 조회
                    const fromFeature = this.source
                        .getFeatures()
                        .find(
                            (f) =>
                                f.get("properties")?.id ===
                                (fromLinkObj as any).id
                        );
                    const toFeature = this.source
                        .getFeatures()
                        .find(
                            (f) =>
                                f.get("properties")?.id ===
                                (toLinkObj as any).id
                        );
                    if (!fromFeature || !toFeature) continue;

                    const fromEndpoints = fromFeature.get("endpoints");
                    const toEndpoints = toFeature.get("endpoints");
                    if (!fromEndpoints || !toEndpoints) continue;

                    // 회전 경로 중심선 좌표: [from, to]
                    const connCenterCoords: [number, number][] = [
                        fromEndpoints.end,
                        toEndpoints.start,
                    ];

                    // direction 벡터 → unitNormal 계산
                    const [x0, y0] = connCenterCoords[0];
                    const [x1, y1] = connCenterCoords[1];
                    const dx = x1 - x0;
                    const dy = y1 - y0;
                    const distLen = Math.hypot(dx, dy);
                    let unitNormal: [number, number] = [0, 0];
                    if (distLen > 0) {
                        unitNormal = [-dy / distLen, dx / distLen];
                    }

                    // Connection 폭(미터) 및 절반 계산
                    const connWidthMeters = conn.width || conn.defaultWidth || 4; // m
                    const halfConnWidth = connWidthMeters / 2;

                    // 좌/우 오프셋 좌표 계산 (두 점 각각 offset)
                    const leftPt1: [number, number] = [
                        x0 + unitNormal[0] * -halfConnWidth,
                        y0 + unitNormal[1] * -halfConnWidth,
                    ];
                    const leftPt2: [number, number] = [
                        x1 + unitNormal[0] * -halfConnWidth,
                        y1 + unitNormal[1] * -halfConnWidth,
                    ];
                    const rightPt1: [number, number] = [
                        x0 + unitNormal[0] * halfConnWidth,
                        y0 + unitNormal[1] * halfConnWidth,
                    ];
                    const rightPt2: [number, number] = [
                        x1 + unitNormal[0] * halfConnWidth,
                        y1 + unitNormal[1] * halfConnWidth,
                    ];

                    // Connection Polygon 좌표
                    const connPolygonCoords: [number, number][] = [
                        leftPt1,
                        leftPt2,
                        rightPt2,
                        rightPt1,
                        leftPt1, // 닫힌 궤적
                    ];

                    // Connection Polygon 생성 및 Feature 추가
                    const connPolyGeom = new Polygon([connPolygonCoords]);
                    const connFeature = new Feature({
                        geometry: connPolyGeom,
                    });
                    // 화살표 계산용으로 start/end 좌표 저장
                    connFeature.set("properties", {
                        ...conn,
                        defaultWidth: connWidthMeters,
                        arrowStart: [x0, y0], // EPSG:3857 좌표
                        arrowEnd: [x1, y1],   // EPSG:3857 좌표
                    });
                    this.source.addFeature(connFeature);
                }
            }

            // Node(정점) Point 생성
            nodes.forEach((node: any) => {
                if (node.lng == null || node.lat == null) return;
                const coord = fromLonLat([node.lng, node.lat]);
                const pointGeom = new Point(coord);

                const nodeFeature = new Feature({
                    geometry: pointGeom,
                });
                nodeFeature.set("properties", node);
                this.source.addFeature(nodeFeature);
            });

            console.log("NetworkLayer: 모든 Feature가 추가됨");
        } catch (error) {
            console.error("NetworkLayer.load() 중 에러 발생:", error);
        }
    }
}
