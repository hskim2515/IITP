import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { LineString, Point, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Coordinate } from "ol/coordinate";
import { Network } from "@type/Network";
import { FeatureLike } from "ol/Feature";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

export default class NetworkFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;

    private unsubscribe: (() => void) | undefined;
    private unsubscribeDraw: (() => void) | undefined;
    private showDetail: boolean = false;

    // 증분 업데이트용 상태
    private prevNetwork: Network | null = null;
    private linkFeaturesMap: Map<string, Feature[]> = new Map(); // linkId → features
    private nodeFeaturesMap: Map<string, Feature[]> = new Map(); // nodeId → features
    private laneMap: Map<string, Feature> = new Map();           // `${linkId}_${laneIdx}` → lane feature
    private lastImportEpoch = 0;  // 마지막으로 처리한 importEpoch
    // 캐시 Map: fullBuild에서 생성, incrementalUpdate에서 증분 갱신
    private cachedNodeMap: Map<string, any> = new Map();
    private cachedLinkMap: Map<string, any> = new Map();

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
                () => { this.load(); },
                { equalityFn: (a:Network, b:Network) => a === b }
            );
        }

        // 도로 그리기 종료 시 fullBuild (draw 중 incremental 누적 후 정리)
        this.unsubscribeDraw = useNetworkDrawStore.subscribe(
            (state, prevState) => {
                const wasDrawing = prevState.isActive || prevState.isConnectionActive;
                const isDrawing  = state.isActive   || state.isConnectionActive;
                if (wasDrawing && !isDrawing) {
                    this.prevNetwork = null; // force fullBuild to clean up any inconsistency
                    this.load();
                }
            }
        );
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
        pullScale: number = 0.4
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

            if (!this.prevNetwork || this.isFullReplace(this.prevNetwork, network)) {
                this.fullBuild(network);
            } else {
                this.incrementalUpdate(this.prevNetwork, network);
            }
            this.prevNetwork = network;
        } catch (e) {
            console.error("NetworkLayer.load 에러:", e);
        }
    }

    private isFullReplace(prev: Network, next: Network): boolean {
        // importEpoch 증가 → 파일 임포트 → 전체 재빌드
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentEpoch = store.getState().importEpoch;
        if (currentEpoch > this.lastImportEpoch) {
            this.lastImportEpoch = currentEpoch;
            return true;
        }
        if (!prev.links?.length || !next.links?.length) return true;

        // Fast path: 첫 링크 참조 동일 → 기존 링크들이 유지된 증분 변경 (도로 그리기)
        if (next.links.length >= prev.links.length && next.links[0] === prev.links[0]) {
            return false;
        }

        // Slow path: 공통 ID 없으면 전체 교체 (다른 파일 로드)
        const hasCommon = next.links.some(l => this.cachedLinkMap.has(String(l.id)));
        return !hasCommon;
    }

    private fullBuild(network: Network): void {
        this.linkFeaturesMap.clear();
        this.nodeFeaturesMap.clear();
        this.laneMap.clear();

        const nodes = network.nodes ?? [];
        const links = network.links ?? [];
        // 캐시 Map 초기화 (이후 incrementalUpdate에서 증분 갱신)
        this.cachedNodeMap = new Map(nodes.map(n => [String(n.id), n]));
        this.cachedLinkMap = new Map(links.map(l => [String(l.id), l]));
        const nodeMap = this.cachedNodeMap;
        const linkMap = this.cachedLinkMap;
        const featureBuffer: Feature[] = [];

        for (const link of links) {
            const features = this.buildLinkFeatures(link, nodeMap);
            if (features.length > 0) {
                this.linkFeaturesMap.set(String(link.id), features);
                featureBuffer.push(...features);
            }
        }
        for (const node of nodes) {
            const features = this.buildNodeFeatures(node, linkMap);
            this.nodeFeaturesMap.set(String(node.id), features);
            featureBuffer.push(...features);
        }

        this.source.clear();
        this.source.addFeatures(featureBuffer);
    }

    private incrementalUpdate(prev: Network, next: Network): void {
        // ── 핵심 최적화: O(N) Map 5개 재생성 대신 참조 동등성 스캔 ──
        // finishSegment()는 links/nodes 배열 끝에만 추가하고, 기존 원소는 같은 참조를 유지한다.

        // 1. 순수 append 검증: 기존 마지막 링크 참조가 동일해야 한다
        //    (split은 filter로 중간 제거 후 concat → 마지막 원소가 달라짐)
        const prevLastLinkIdx = prev.links.length - 1;
        const isPureAppend =
            next.links.length >= prev.links.length &&
            next.nodes.length >= prev.nodes.length &&
            prevLastLinkIdx >= 0 &&
            next.links[prevLastLinkIdx] === prev.links[prevLastLinkIdx];

        if (!isPureAppend) {
            this.fullBuild(next);
            return;
        }

        // 2. 참조 스캔으로 변경된 기존 노드 인덱스 수집 (Map 생성 없이 O(N) 스캔)
        const changedNodeIndices: number[] = [];
        const minNodeLen = Math.min(prev.nodes.length, next.nodes.length);
        for (let i = 0; i < minNodeLen; i++) {
            if (prev.nodes[i] !== next.nodes[i]) changedNodeIndices.push(i);
        }

        // 3. 끝에 append된 신규 항목
        const newLinks = next.links.length > prev.links.length
            ? next.links.slice(prev.links.length) : [];
        const newNodes = next.nodes.length > prev.nodes.length
            ? next.nodes.slice(prev.nodes.length) : [];

        if (changedNodeIndices.length === 0 && newLinks.length === 0 && newNodes.length === 0) return;

        // 4. 캐시 Map 증분 갱신 (전체 재생성 없이 변경분만)
        for (const i of changedNodeIndices) {
            const node = next.nodes[i]!;
            this.cachedNodeMap.set(String(node.id), node);
        }
        for (const node of newNodes) {
            this.cachedNodeMap.set(String(node.id), node);
        }
        for (const link of newLinks) {
            this.cachedLinkMap.set(String(link.id), link);
        }

        // 5. 신규 링크 피처 추가 (먼저: laneMap이 채워져야 노드 conn 빌드 가능)
        const addBuffer: Feature[] = [];
        for (const link of newLinks) {
            const features = this.buildLinkFeatures(link, this.cachedNodeMap);
            if (features.length > 0) {
                this.linkFeaturesMap.set(String(link.id), features);
                addBuffer.push(...features);
            }
        }

        // 6. 변경된 노드: 기존 피처 제거 없이 delta port/conn만 append (O(1))
        //    finishSegment는 ports/connections를 항상 끝에 추가(append)하므로
        //    slice(prevLen)으로 신규 항목만 골라 피처를 추가한다.
        for (const i of changedNodeIndices) {
            const prevNode = prev.nodes[i]!;
            const nextNode = next.nodes[i]!;
            const id = String(nextNode.id);
            const existingFeatures = this.nodeFeaturesMap.get(id) ?? [];

            const newPorts = nextNode.ports.slice(prevNode.ports.length);
            for (const port of newPorts) {
                const link = this.cachedLinkMap.get(String(port.linkId));
                if (!link) continue;
                let portPos: number[];
                if (port.type === 'out' && link.coordinates?.[0]) {
                    portPos = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
                } else if (port.type === 'in' && link.coordinates?.length) {
                    const last = link.coordinates[link.coordinates.length - 1];
                    portPos = fromLonLat([last.lng, last.lat]);
                } else {
                    portPos = fromLonLat([nextNode.coordinates.lng, nextNode.coordinates.lat]);
                }
                const portFeature = new Feature({ ...port, geometry: new Point(portPos), featureType: 'ports' });
                existingFeatures.push(portFeature);
                addBuffer.push(portFeature);
            }

            const newConns = nextNode.connections.slice(prevNode.connections.length);
            const nodePt = fromLonLat([nextNode.coordinates.lng, nextNode.coordinates.lat]);
            for (const conn of newConns) {
                let fromPt: number[], toPt: number[];
                if (conn.coordinates?.length >= 2) {
                    fromPt = fromLonLat([conn.coordinates[0].lng, conn.coordinates[0].lat]);
                    toPt   = fromLonLat([conn.coordinates[conn.coordinates.length - 1].lng, conn.coordinates[conn.coordinates.length - 1].lat]);
                } else {
                    const fromLaneFeat = this.laneMap.get(`${conn.fromLink}_${conn.fromLane}`);
                    const toLaneFeat   = this.laneMap.get(`${conn.toLink}_${conn.toLane}`);
                    if (!fromLaneFeat || !toLaneFeat) continue;
                    fromPt = fromLaneFeat.get('laneTarget');
                    toPt   = toLaneFeat.get('laneSource');
                }
                if (!fromPt || !toPt) continue;
                const coord = conn.turning === 'Straight'
                    ? [fromPt, toPt]
                    : this.generateQuadraticBezierCurve(fromPt, nodePt, toPt);
                if (!coord || coord.length < 2) continue;
                const connFeature = new Feature(new LineString(coord));
                connFeature.setProperties({ ...conn, featureType: 'connections', fromNodeType: nextNode.type, nodeId: nextNode.id });
                existingFeatures.push(connFeature);
                addBuffer.push(connFeature);
            }

            this.nodeFeaturesMap.set(id, existingFeatures);
        }

        // 7. 신규 노드 피처 추가
        for (const node of newNodes) {
            const features = this.buildNodeFeatures(node, this.cachedLinkMap);
            this.nodeFeaturesMap.set(String(node.id), features);
            addBuffer.push(...features);
        }

        if (addBuffer.length > 0) {
            this.source.addFeatures(addBuffer);
        }
    }

    private buildLinkFeatures(link: any, nodeMap: Map<string, any>): Feature[] {
        const sourceNode = nodeMap.get(String(link.fromNode));
        const targetNode = nodeMap.get(String(link.toNode));
        if (!sourceNode || !targetNode || !link.lanes) return [];
        if (!link.coordinates || !link.coordinates[0] || !link.coordinates[1]) return [];

        const p1 = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
        const lastCoord = link.coordinates[link.coordinates.length - 1];
        const p2 = fromLonLat([lastCoord.lng, lastCoord.lat]);
        const p1b = fromLonLat([link.coordinates[1].lng, link.coordinates[1].lat]);
        if (!p1[0] || !p1[1] || !p2[0] || !p2[1]) return [];

        const dx = p1b[0] - p1[0], dy = p1b[1] - p1[1];
        const len = Math.hypot(dx, dy);
        const unitNormal: [number, number] = len > 0 ? [-dy / len, dx / len] : [0, 0];

        const features: Feature[] = [];

        // link-edit (center line)
        const linkLineFeature = new Feature(new LineString([p1, p2]));
        linkLineFeature.setProperties({ ...link, featureType: "link-edit", linkRef: link.id });
        features.push(linkLineFeature);

        // link polygon
        const half = (link.width ?? 0) / 2;
        const left = [p1, p2].map(([x, y]) => x && y ? [x - unitNormal[0] * half, y - unitNormal[1] * half] : undefined);
        const right = [p2, p1].map(([x, y]) => x && y ? [x + unitNormal[0] * half, y + unitNormal[1] * half] : undefined);
        const linkPolygonFeature = new Feature(new Polygon([[...left, ...right, left[0]]]));
        linkPolygonFeature.setProperties({ ...link, featureType: "links" });
        features.push(linkPolygonFeature);

        // lanes
        const laneCount = link.lanes.length;
        const laneWidth = link.width / laneCount;

        for (let i = 0; i < laneCount; i++) {
            const lane = link.lanes[i];
            if (!lane) continue;
            const offsetCenter = ((laneCount - 1) / 2 - i) * laneWidth;
            const centerP1 = [p1[0] + unitNormal[0] * offsetCenter, p1[1] + unitNormal[1] * offsetCenter];
            const centerP2 = [p2[0] + unitNormal[0] * offsetCenter, p2[1] + unitNormal[1] * offsetCenter];
            const halfWidth = laneWidth / 2;
            const outerP1 = [centerP1[0] + unitNormal[0] * halfWidth, centerP1[1] + unitNormal[1] * halfWidth];
            const outerP2 = [centerP2[0] + unitNormal[0] * halfWidth, centerP2[1] + unitNormal[1] * halfWidth];
            const innerP1 = [centerP1[0] - unitNormal[0] * halfWidth, centerP1[1] - unitNormal[1] * halfWidth];
            const innerP2 = [centerP2[0] - unitNormal[0] * halfWidth, centerP2[1] - unitNormal[1] * halfWidth];

            const laneProps = {
                ...lane, linkRef: link.id, featureType: "lanes",
                length: link.length, laneRef: i,
                laneSource: centerP1, laneTarget: centerP2,
            };
            const laneFeature = new Feature(new Polygon([[innerP1, innerP2, outerP2, outerP1, innerP1]]));
            laneFeature.setProperties(laneProps);
            this.laneMap.set(`${link.id}_${i}`, laneFeature); // 클래스 laneMap 갱신
            features.push(laneFeature);

            const laneLineFeature = new Feature(new LineString([centerP1, centerP2]));
            laneLineFeature.setProperties({ ...laneProps, featureType: "lane-edit" });
            features.push(laneLineFeature);

            if (this.showDetail && lane.cells?.length > 0) {
                const cellWidth = laneWidth * NetworkFeatureLayer.CELL_WIDTH_RATIO;
                for (const cell of lane.cells) {
                    const startOffset = cell.offset ?? 0;
                    const unitLen = Math.max(0, cell.length ?? 5);
                    this.createRectanglesTiledAlongLane(centerP1, centerP2, startOffset, unitLen, cellWidth)
                        .forEach((ring, idx) => {
                            const cellFeature = new Feature(new Polygon([ring]));
                            cellFeature.setProperties({ ...cell, featureType: "cells", linkRef: link.id, laneRef: i, offset: startOffset + unitLen * idx, chunkIndex: idx });
                            features.push(cellFeature);
                        });
                }
            }

            if (this.showDetail && lane.segments?.length > 0) {
                const segWidth = laneWidth * NetworkFeatureLayer.SEGMENT_WIDTH_RATIO;
                for (const segment of lane.segments) {
                    const init = segment.initPoint ?? 0;
                    const end = segment.endPoint ?? init;
                    const offset = Math.min(init, end);
                    const length = Math.max(0, Math.abs(end - init));
                    const ring = this.createRectangleAlongLane(centerP1, centerP2, offset, length, segWidth);
                    if (!ring) continue;
                    const segFeature = new Feature(new Polygon([ring]));
                    segFeature.setProperties({ ...segment, featureType: "segments", linkRef: link.id, laneRef: i, offset, length });
                    features.push(segFeature);
                }
            }
        }
        return features;
    }

    private buildNodeFeatures(node: any, linkMap: Map<string, any>): Feature[] {
        const features: Feature[] = [];
        const nodePt = fromLonLat([node.coordinates.lng, node.coordinates.lat]);

        const nodeFeature = new Feature(new Point(nodePt));
        nodeFeature.setProperties({ ...node, featureType: "nodes" });
        features.push(nodeFeature);

        for (const conn of (node.connections ?? [])) {
            let fromPt: Coordinate, toPt: Coordinate;

            if (conn.coordinates?.length >= 2) {
                fromPt = fromLonLat([conn.coordinates[0].lng, conn.coordinates[0].lat]);
                toPt = fromLonLat([conn.coordinates[conn.coordinates.length - 1].lng, conn.coordinates[conn.coordinates.length - 1].lat]);
            } else {
                const fromLaneFeat = this.laneMap.get(`${conn.fromLink}_${conn.fromLane}`);
                const toLaneFeat = this.laneMap.get(`${conn.toLink}_${conn.toLane}`);
                if (!fromLaneFeat || !toLaneFeat) continue;
                fromPt = fromLaneFeat.get("laneTarget");
                toPt = toLaneFeat.get("laneSource");
            }
            if (!fromPt || !toPt) continue;

            const coord: Coordinate[] = conn.turning === "Straight"
                ? [fromPt, toPt]
                : this.generateQuadraticBezierCurve(fromPt, fromLonLat([node.coordinates.lng, node.coordinates.lat]), toPt);
            if (!coord || coord.length < 2) continue;

            const connFeature = new Feature(new LineString(coord));
            connFeature.setProperties({ ...conn, featureType: "connections", fromNodeType: node.type, nodeId: node.id });
            features.push(connFeature);
        }

        for (const port of (node.ports ?? [])) {
            const link = linkMap.get(String(port.linkId));
            if (!link) continue;
            // out: link 시작(node에서 나감), in: link 끝(node로 들어옴)
            let portPos: Coordinate = nodePt;
            if (port.type === "out" && link.coordinates?.[0]) {
                portPos = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
            } else if (port.type === "in" && link.coordinates?.length) {
                const last = link.coordinates[link.coordinates.length - 1];
                portPos = fromLonLat([last.lng, last.lat]);
            }
            const portFeature = new Feature({ ...port, geometry: new Point(portPos), featureType: "ports" });
            features.push(portFeature);
        }
        return features;
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
        this.unsubscribe?.();
        this.unsubscribeDraw?.();
        super.dispose();
    }
}
