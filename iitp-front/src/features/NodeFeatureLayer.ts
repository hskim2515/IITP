import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { LineString, Point, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Coordinate } from "ol/coordinate";
import { Network } from "@type/Network";
import { getTriangleConnectionPoints } from "@utils/network";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";

export default class NetworkFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;

    private unsubscribe: (() => void) | undefined;

    private readonly LAYER_NAME = "network";

    private static readonly CELL_WIDTH_RATIO = 0.25;
    private static readonly SEGMENT_WIDTH_RATIO = 0.4;

    private static readonly EPS = 1e-9;
    private static readonly PORT_ICON_SCALE = 2.0;
    private static readonly NODE_RADIUS_SCALE = 0.8;
    private static readonly NODE_STROKE_SCALE = 0.1;

    // zIndex 맵
    private zIndexMap: Record<string, number> = {
        "links": 10,
        "link-edit": 110,
        "lanes": 20,
        "lane-edit": 120,
        "cells": 25,
        "segments": 26,
        "connections": 30,
        "ports": 160,
        "nodes": 200,
    };

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
            zIndex: 300,
        });

        this.source = source;
        this.load();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state: { currentJsonData: Network; }) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load(); // 데이터가 변경되면 레이어를 다시 로드합니다.
                },
                { equalityFn: (a:Network, b:Network) => diff(a, b) === undefined}
            );
        }
    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const props: any = feature.getProperties() ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        const featureType = props.featureType ?? "";
        const zIndex = this.zIndexMap[featureType] ?? 0;
        const res = Math.max(resolution, NetworkFeatureLayer.EPS);

        // LINK (polygon)
        if (geom instanceof Polygon && featureType === "links") {
            styles.push(new Style({
                fill: new Fill({ color: "rgb(255,255,255,0.7)" }),
                zIndex
            }));
        }

        // LINK-EDIT (center line)
        if (geom instanceof LineString && featureType === "link-edit") {
            styles.push(new Style({
                stroke: new Stroke({ color: "rgba(200,0,0,0.75)", width: Math.min(2, 0.3 / res) }),
                zIndex
            }));
        }

        // LANE (polygon)
        if (geom instanceof Polygon && featureType === "lanes") {
            styles.push(new Style({
                fill: new Fill({ color: "rgb(100,100,100, 0.8)" }),
                stroke: new Stroke({ color: "rgb(255,255,255,0.7)", width: Math.min(2, 0.5 / res) }),
                zIndex
            }));
        }

        // LANE-EDIT (center line)
        if (geom instanceof LineString && featureType === "lane-edit") {
            styles.push(new Style({
                zIndex
            }));
        }

        // CELL (polygon) — 빨강 분할 폴리곤
        if (geom instanceof Polygon && featureType === "cells") {
            styles.push(new Style({
                fill: new Fill({ color: "rgba(200,0,0,0.75)" }),
                stroke: new Stroke({ color: "rgba(200,0,0,0.75)", width: Math.min(2, 0.3 / res) }),
                zIndex
            }));
        }

        // SEGMENT (polygon)
        if (geom instanceof Polygon && featureType === "segments") {
            const isBlocked = !!props.block;
            const fillColor = isBlocked ? "rgba(255,255,0,0.8)" : "rgba(0,0,255,0.5)";
            const strokeColor = isBlocked ? "rgba(128,128,0,0.9)" : "rgba(0,0,128,0.9)";
            styles.push(new Style({
                fill: new Fill({ color: fillColor }),
                stroke: new Stroke({ color: strokeColor, width: Math.min(2, 0.3 / res) }),
                zIndex
            }));
        }

        // CONNECTIONS (polyline + arrow head)
        if (geom instanceof LineString && featureType === "connections") {
            const color = "#ffffff";
            styles.push(new Style({
                stroke: new Stroke({ color, width: Math.min(3, 0.5 / res) }),
                zIndex
            }));

            const coordinates = geom.getCoordinates();
            if (coordinates.length >= 2) {
                const end = coordinates[coordinates.length - 1];
                const start = coordinates[coordinates.length - 2];

                const dx = end[0] - start[0];
                const dy = end[1] - start[1];
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                    const ux = dx / len;
                    const uy = dy / len;
                    const nx = -uy;
                    const ny = ux;

                    const arrowLength = 1.8;
                    const baseWidth = 0.8;

                    const baseCenter: [number, number] = [
                        end[0] - ux * arrowLength,
                        end[1] - uy * arrowLength,
                    ];

                    const baseLeft: [number, number] = [
                        baseCenter[0] + nx * baseWidth / 2,
                        baseCenter[1] + ny * baseWidth / 2,
                    ];
                    const baseRight: [number, number] = [
                        baseCenter[0] - nx * baseWidth / 2,
                        baseCenter[1] - ny * baseWidth / 2,
                    ];

                    styles.push(new Style({
                        geometry: new Polygon([[baseLeft, baseRight, end, baseLeft]]),
                        fill: new Fill({ color }),
                        stroke: new Stroke({ color, width: 0.1 }),
                    }));
                }
            }
        }

        if (geom instanceof Point && featureType === "nodes") {
            const radius = NetworkFeatureLayer.NODE_RADIUS_SCALE / res;  // 무제한 확대
            const strokeWidth = NetworkFeatureLayer.NODE_STROKE_SCALE / res;
            styles.push(new Style({
                image: new CircleStyle({
                    radius,
                    fill: new Fill({ color: "rgba(255, 255, 0, 1)" }),
                    stroke: new Stroke({ color: "rgb(128,128,0)", width: 0.1 }),
                }),
                zIndex
            }));
        }
        if (geom instanceof Point && featureType === "ports") {
            const portType = props.type; // 피처에 설정된 'in' 또는 'out'
            const r = NetworkFeatureLayer.PORT_ICON_SCALE / res;
            const strokeW = (0.2 * 0.2) / res;

            if (portType === "out") {
                const outFill = "rgba(0,200,200,0.5)";
                styles.push(new Style({
                    image: new CircleStyle({
                        radius: r * 0.75,
                        fill: new Fill({ color: outFill }),
                    }),
                    zIndex: zIndex + 1 // 예: 160
                }));
            }
            else if (portType === "in") {
                const inFill = "rgba(200,0,200,0.5)";

                styles.push(new Style({
                    image: new CircleStyle({
                        radius: r,
                        fill: new Fill({ color: inFill }),
                    }),
                    zIndex: zIndex
                }));
            }
        }

        return styles;
    }

    private generateQuadraticBezierCurve(
        from: Coordinate,
        controlPoint: Coordinate,
        to: Coordinate,
        numberOfPoints: number = 15,
        pullScale: number = 0.9
    ): Coordinate[] {
        const basePoint: Coordinate = [
            (from[0] + to[0]) / 2,
            (from[1] + to[1]) / 2,
        ];

        const effectiveControlPoint: Coordinate = [
            basePoint[0] + (controlPoint[0] - basePoint[0]) * pullScale,
            basePoint[1] + (controlPoint[1] - basePoint[1]) * pullScale,
        ];

        const curvePoints: Coordinate[] = [];
        for (let i = 0; i <= numberOfPoints; i++) {
            const t = i / numberOfPoints;
            const tInv = 1 - t;
            const x = (tInv ** 2) * from[0] + 2 * tInv * t * effectiveControlPoint[0] + (t ** 2) * to[0];
            const y = (tInv ** 2) * from[1] + 2 * tInv * t * effectiveControlPoint[1] + (t ** 2) * to[1];
            curvePoints.push([x, y]);
        }
        return curvePoints;
    }

    private createRectangleAlongLane(
        source: Coordinate,
        target: Coordinate,
        offset: number,
        length: number,
        width: number
    ): Coordinate[] | null {
        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const L = Math.hypot(dx, dy);
        if (L === 0) return null;

        const ux = dx / L;
        const uy = dy / L;
        const nx = -uy;
        const ny = ux;

        const startDist = Math.max(0, Math.min(L, offset));
        const endDist = Math.max(startDist, Math.min(L, offset + Math.max(0, length)));
        if (endDist <= startDist) return null;

        const halfW = width / 2;

        const sx = source[0] + ux * startDist;
        const sy = source[1] + uy * startDist;
        const ex = source[0] + ux * endDist;
        const ey = source[1] + uy * endDist;

        const leftStart: Coordinate = [sx + nx * halfW, sy + ny * halfW];
        const leftEnd: Coordinate = [ex + nx * halfW, ey + ny * halfW];
        const rightEnd: Coordinate = [ex - nx * halfW, ey - ny * halfW];
        const rightStart: Coordinate = [sx - nx * halfW, sy - ny * halfW];

        return [leftStart, leftEnd, rightEnd, rightStart, leftStart];
    }

    private createRectanglesTiledAlongLane(
        source: Coordinate,
        target: Coordinate,
        offset: number,
        unitLength: number,
        width: number
    ): Coordinate[][] {
        const rings: Coordinate[][] = [];

        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const L = Math.hypot(dx, dy);
        if (L === 0) return rings;

        const startDist = Math.max(0, Math.min(L, offset));
        const remain = Math.max(0, L - startDist);
        if (remain === 0) return rings;

        const step = Math.max(0, unitLength);
        if (step === 0) return rings;

        const nFull = Math.floor(remain / step);
        const rem = remain - nFull * step;

        let curStart = startDist;

        for (let i = 0; i < nFull; i++) {
            const ring = this.createRectangleAlongLane(source, target, curStart, step, width);
            if (ring) rings.push(ring);
            curStart += step;
        }

        if (rem > 1e-9) {
            const ring = this.createRectangleAlongLane(source, target, curStart, rem, width);
            if (ring) rings.push(ring);
        }

        return rings;
    }

    public async load(): Promise<void> {
        const store = layerNameToStoreMap[this.LAYER_NAME];

        try {
            const network: Network | undefined = store.getState().currentJsonData;
            if (!network) return;
            const nodes = network.nodes ?? [];
            const links = network.links ?? [];

            const featureBuffer: Feature[] = [];
            const laneMap = new Map<string | number, Feature>();
            const linkMap = new Map<string | number, any>();

            for (const link of links) {
                const source = nodes.find(n => n.id == link.fromNode);
                const target = nodes.find(n => n.id == link.toNode);
                if (!source || !target || !link.lanes) continue;

                linkMap.set(link.id, link);

                if(!link.coordinates || !link.coordinates[0] || !link.coordinates[1]) continue
                const p1 = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
                const p2 = fromLonLat([link.coordinates[1].lng, link.coordinates[1].lat]);

                if(!p1 || !p2 || !p1[0] || !p1[1] || !p2[0] || !p2[1]) continue
                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const len = Math.hypot(dx, dy);
                const unitNormal: [number, number] = len > 0 ? [-dy / len, dx / len] : [0, 0];

                const linkLine = new LineString([p1, p2]);
                const linkLineFeature = new Feature(linkLine);
                linkLineFeature.setProperties({ ...link, featureType: "link-edit", linkRef: link.id });
                featureBuffer.push(linkLineFeature);

                const half = (link.width ?? 0) / 2;
                const left = [p1, p2].map(([x, y]) => {
                    if(!x || !y) return;
                    return [x - unitNormal[0] * half, y - unitNormal[1] * half]
                });
                const right = [p2, p1].map(([x, y]) => {
                    if(!x || !y) return;
                    return [x + unitNormal[0] * half, y + unitNormal[1] * half]
                });

                const linkPolygon = new Polygon([[...left, ...right, left[0]]]);
                const linkPolygonFeature = new Feature(linkPolygon);
                linkPolygonFeature.setProperties({ ...link, featureType: "links" });
                featureBuffer.push(linkPolygonFeature);

                const laneCount = link.lanes?.length;
                const laneWidth = link.width / laneCount

                for (let i = 0; i < laneCount; i++) {
                    const lane = link.lanes[i];
                    if(!lane) continue;
                    const offsetCenter = ((laneCount - 1) / 2 - i) * laneWidth;


                    const centerP1 = [p1[0] + unitNormal[0] * offsetCenter, p1[1] + unitNormal[1] * offsetCenter];
                    const centerP2 = [p2[0] + unitNormal[0] * offsetCenter, p2[1] + unitNormal[1] * offsetCenter];

                    const halfWidth = laneWidth / 2;
                    const outerP1 = [centerP1[0] + unitNormal[0] * halfWidth, centerP1[1] + unitNormal[1] * halfWidth];
                    const outerP2 = [centerP2[0] + unitNormal[0] * halfWidth, centerP2[1] + unitNormal[1] * halfWidth];
                    const innerP1 = [centerP1[0] - unitNormal[0] * halfWidth, centerP1[1] - unitNormal[1] * halfWidth];
                    const innerP2 = [centerP2[0] - unitNormal[0] * halfWidth, centerP2[1] - unitNormal[1] * halfWidth];

                    const laneProps = {
                        ...lane,
                        linkRef: link.id,
                        featureType: "lanes",
                        length: link.length,
                        laneRef: i,
                        laneSource: centerP1,
                        laneTarget: centerP2,
                    };

                    const laneFeature = new Feature(new Polygon([[innerP1, innerP2, outerP2, outerP1, innerP1]]));
                    laneFeature.setProperties(laneProps);
                    const laneKey = `${link.id}_${(lane.id ?? i)}`;
                    laneMap.set(laneKey, laneFeature);
                    featureBuffer.push(laneFeature);

                    const laneLineFeature = new Feature(new LineString([centerP1, centerP2]));
                    laneLineFeature.setProperties({ ...laneProps, featureType: "lane-edit" });
                    featureBuffer.push(laneLineFeature);

                    if (lane?.cells?.length > 0) {
                        const cellWidth = laneWidth * NetworkFeatureLayer.CELL_WIDTH_RATIO;

                        for (const cell of lane.cells) {
                            const startOffset = cell.offset ?? 0;
                            const unitLen = Math.max(0, cell.length ?? 5);

                            const rings = this.createRectanglesTiledAlongLane(
                                laneProps.laneSource,
                                laneProps.laneTarget,
                                startOffset,
                                unitLen,
                                cellWidth
                            );

                            rings.forEach((ring, idx) => {
                                const chunkLen = this.measureChunkLength(laneProps.laneSource, laneProps.laneTarget, ring);
                                const cellFeature = new Feature(new Polygon([ring]));
                                cellFeature.setProperties({
                                    ...cell,
                                    featureType: "cells",
                                    linkRef: link.id,
                                    laneRef: i,
                                    offset: startOffset + unitLen * idx,
                                    length: chunkLen,
                                    chunkIndex: idx,
                                });
                                featureBuffer.push(cellFeature);
                            });
                        }
                    }

                    if (lane?.segments?.length > 0) {
                        const segWidth = laneWidth * NetworkFeatureLayer.SEGMENT_WIDTH_RATIO;
                        for (const segment of lane.segments) {
                            const init = segment.initPoint ?? 0;
                            const end = segment.endPoint ?? init;
                            const offset = Math.min(init, end);
                            const length = Math.max(0, Math.abs(end - init));

                            const ring = this.createRectangleAlongLane(
                                laneProps.laneSource,
                                laneProps.laneTarget,
                                offset,
                                length,
                                segWidth
                            );
                            if (!ring) continue;

                            const segmentFeature = new Feature(new Polygon([ring]));
                            segmentFeature.setProperties({
                                ...segment,
                                featureType: "segments",
                                linkRef: link.id,
                                laneRef: i,
                                offset,
                                length,
                            });
                            featureBuffer.push(segmentFeature);
                        }
                    }
                }
            }

            for (const node of nodes) {
                const nodePt = fromLonLat([node.coordinates.lng, node.coordinates.lat]);

                const point = new Point(nodePt);
                const nodeFeature = new Feature(point);
                nodeFeature.setProperties({ ...node, featureType: "nodes" });
                featureBuffer.push(nodeFeature);

                if (!node.connections) continue;

                for (const conn of node.connections) {
                    const fromKey = `${conn.fromLink}_${conn.fromLane}`;
                    const toKey = `${conn.toLink}_${conn.toLane}`;

                    const fromLaneFeat = laneMap.get(fromKey);
                    const toLaneFeat = laneMap.get(toKey);

                    if (!fromLaneFeat || !toLaneFeat) continue;

                    const fromPt: Coordinate = fromLaneFeat.get("laneTarget");
                    const toPt: Coordinate = toLaneFeat.get("laneSource");

                    let coord: Coordinate[];
                    if (conn.turning === "Straight") {
                        coord = [fromPt, toPt];
                    } else {
                        const fromLink = linkMap.get(conn.fromLink);
                        const toLink = linkMap.get(conn.toLink);

                        if (!fromLink || !toLink) {
                            coord = [fromPt, toPt];
                        } else {
                            const fromLinkP1 = fromLonLat([fromLink.coordinates[0].lng, fromLink.coordinates[0].lat]);
                            const fromLinkP2 = fromLonLat([fromLink.coordinates[1].lng, fromLink.coordinates[1].lat]);
                            const fromVector = [fromLinkP2[0] - fromLinkP1[0], fromLinkP2[1] - fromLinkP1[1]];

                            const toLinkP1 = fromLonLat([toLink.coordinates[0].lng, toLink.coordinates[0].lat]);
                            const toLinkP2 = fromLonLat([toLink.coordinates[1].lng, toLink.coordinates[1].lat]);
                            const toVector = [toLinkP2[0] - toLinkP1[0], toLinkP2[1] - toLinkP1[1]];

                            const triangleVertices = getTriangleConnectionPoints(fromPt, toPt, fromVector, toVector);
                            if (triangleVertices) {
                                const [p1, controlPoint, p2] = triangleVertices;
                                coord = this.generateQuadraticBezierCurve(fromPt, controlPoint, toPt);
                            } else {
                                coord = [fromPt, toPt];
                            }
                        }
                    }

                    if (!coord || coord.length < 2) continue;

                    const connLine = new LineString(coord);
                    const connLineFeature = new Feature(connLine);
                    connLineFeature.setProperties({
                        ...conn,
                        featureType: "connections",
                        fromNodeType: node.type,
                        nodeId: node.id,
                    });
                    featureBuffer.push(connLineFeature);
                }

                if (!node.ports) continue;
                for (const port of node.ports) {
                    const link = links.find((l) => l.id == port.linkId);
                    if (!link) continue;

                    const portFeature = new Feature({
                        ...port,
                        geometry: new Point(nodePt),
                        featureType: "ports",
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

    private measureChunkLength(source: Coordinate, target: Coordinate, ring: Coordinate[]): number {
        if (ring.length < 4) return 0;
        const leftStart = ring[0];
        const leftEnd = ring[1];
        const rightEnd = ring[2];
        const rightStart = ring[3];

        const midStart = [(leftStart[0] + rightStart[0]) / 2, (leftStart[1] + rightStart[1]) / 2];
        const midEnd = [(leftEnd[0] + rightEnd[0]) / 2, (leftEnd[1] + rightEnd[1]) / 2];

        const dx = midEnd[0] - midStart[0];
        const dy = midEnd[1] - midStart[1];
        return Math.hypot(dx, dy);
    }

    public dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        super.dispose();
    }
}
