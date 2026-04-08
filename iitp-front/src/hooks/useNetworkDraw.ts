import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Feature } from 'ol';
import { LineString, Point, Polygon } from 'ol/geom';
import { Stroke, Fill, Style, Circle as CircleStyle } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Coordinate } from 'ol/coordinate';
import { getDistance } from 'ol/sphere';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import { useMessageStore } from '@stores/useMessageStore';
import { generateGUID, assignPropertyToResponseData } from '@utils/guid';
import { Network, Node, Link, Lane, Cell, Segment, Port, Connection, Coordinates } from '@type/Network';
import { UpdateLogEntry } from '@type/HistoryTypes';

/** 신규 추가 객체의 모든 필드를 added 항목으로 수집 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectAdded(item: any): NonNullable<UpdateLogEntry['added']> {
    if (!item?.__guid) return [];
    return Object.entries(item as Record<string, unknown>).map(([field, value]) => ({
        guid: item.__guid as string, field, oldValue: null, newValue: value,
    }));
}

const SNAP_RADIUS_M = 25;
const SNAP_LINK_RADIUS_M = 15;   // 링크 위 스냅 임계값 (m)
const OL_PREVIEW_Z = 500;

// ── OL 프리뷰 스타일 ────────────────────────────────────────────
const roadPreviewStyle = new Style({
    fill: new Fill({ color: 'rgba(65, 105, 225, 0.28)' }),
    stroke: new Stroke({ color: 'rgba(100, 140, 255, 0.9)', width: 1.5 }),
});
const centerLineStyle = new Style({
    stroke: new Stroke({ color: 'rgba(255,255,255,0.85)', width: 1.5, lineDash: [6, 5] }),
});
const snapStyle = new Style({
    image: new CircleStyle({
        radius: 12,
        fill: new Fill({ color: 'rgba(0,230,150,0.2)' }),
        stroke: new Stroke({ color: 'rgba(0,230,150,1)', width: 2 }),
    }),
});
const startNodeStyle = new Style({
    image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: 'rgba(65,105,225,1)' }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
});
const endNodePreviewStyle = new Style({
    image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: 'rgba(255,255,255,0.8)' }),
        stroke: new Stroke({ color: 'rgba(65,105,225,0.9)', width: 1.5 }),
    }),
});
const linkSnapStyle = new Style({
    image: new CircleStyle({
        radius: 11,
        fill: new Fill({ color: 'rgba(255,165,0,0.2)' }),
        stroke: new Stroke({ color: 'rgba(255,165,0,1)', width: 2.5 }),
    }),
});

// ── 유틸 ────────────────────────────────────────────────────────
function buildRoadPolygon(p1: Coordinate, p2: Coordinate, halfW: number): Coordinate[] | null {
    const dx = p2[0]! - p1[0]!, dy = p2[1]! - p1[1]!;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const nx = (-dy / len) * halfW, ny = (dx / len) * halfW;
    return [
        [p1[0]! + nx, p1[1]! + ny], [p2[0]! + nx, p2[1]! + ny],
        [p2[0]! - nx, p2[1]! - ny], [p1[0]! - nx, p1[1]! - ny],
        [p1[0]! + nx, p1[1]! + ny],
    ];
}

function findSnapNode(nodes: Node[], lonLat: number[]): Node | null {
    let best: Node | null = null, minDist = SNAP_RADIUS_M;
    for (const n of nodes) {
        const d = getDistance([n.coordinates.lng, n.coordinates.lat], [lonLat[0], lonLat[1]]);
        if (d < minDist) { minDist = d; best = n; }
    }
    return best;
}

// ── 링크 위 최근접점 스냅 ────────────────────────────────────────
type LinkSnap = { link: Link; coord: Coordinate; wgs84: Coordinates };

function findSnapLink(links: Link[], cursor: Coordinate, nodeSnapped: boolean): LinkSnap | null {
    if (nodeSnapped) return null; // 노드 스냅 우선
    let best: LinkSnap | null = null;
    let bestDist = SNAP_LINK_RADIUS_M;

    for (const link of links) {
        const c = link.coordinates;
        for (let si = 0; si < c.length - 1; si++) {
            const a = fromLonLat([c[si]!.lng, c[si]!.lat]);
            const b = fromLonLat([c[si + 1]!.lng, c[si + 1]!.lat]);
            const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-10) continue;
            // t를 0.05~0.95로 제한 → 끝점 근처는 노드 스냅에 맡김
            const t = Math.max(0.05, Math.min(0.95,
                ((cursor[0]! - a[0]!) * dx + (cursor[1]! - a[1]!) * dy) / len2
            ));
            const px = a[0]! + t * dx, py = a[1]! + t * dy;
            const ll = toLonLat([px, py]);
            const distM = getDistance(toLonLat(cursor), ll);
            if (distM < bestDist) {
                bestDist = distM;
                best = { link, coord: [px, py], wgs84: { lng: ll[0]!, lat: ll[1]! } };
            }
        }
    }
    return best;
}

// ── 교차 노드 커넥션 자동 재생성 ────────────────────────────────
// 노드의 모든 in-link / out-link 조합으로 S/L/R 커넥션을 새로 계산
function regenerateNodeConnections(network: Network, nodeId: number | string): Network {
    const node = network.nodes.find(n => String(n.id) === String(nodeId));
    if (!node) return network;

    const inLinks = node.ports
        .filter(p => p.type === 'in')
        .map(p => network.links.find(l => String(l.id) === String(p.linkId)))
        .filter((l): l is Link => !!l);
    const outLinks = node.ports
        .filter(p => p.type === 'out')
        .map(p => network.links.find(l => String(l.id) === String(p.linkId)))
        .filter((l): l is Link => !!l);

    const newConns: Connection[] = [];
    for (const inLink of inLinks) {
        for (const outLink of outLinks) {
            if (String(inLink.id) === String(outLink.id)) continue;
            const arrival   = linkArrivalBearing(inLink);
            const departure = linkDepartureBearing(outLink);
            const turning   = classifyTurning(arrival, departure);
            if (turning === 'U_Turn') continue;
            newConns.push(...makeConnections(inLink, outLink, turning, newConns.length));
        }
    }

    return {
        ...network,
        nodes: network.nodes.map(n =>
            String(n.id) === String(nodeId)
                ? { ...n, connections: newConns, numConnection: newConns.length }
                : n
        ),
    };
}

// ── 노드 병합 (두 노드를 하나로 합침) ──────────────────────────
function mergeNodes(
    network: Network,
    keepNodeId: number | string,
    removeNodeId: number | string,
): Network {
    const removeNode = network.nodes.find(n => String(n.id) === String(removeNodeId));
    const keepNode   = network.nodes.find(n => String(n.id) === String(keepNodeId));
    if (!removeNode || !keepNode) return network;

    // removeNode를 참조하는 모든 링크를 keepNode로 교체
    const updatedLinks = network.links.map(l => ({
        ...l,
        fromNode: (String(l.fromNode) === String(removeNodeId) ? keepNodeId : l.fromNode) as number,
        toNode:   (String(l.toNode)   === String(removeNodeId) ? keepNodeId : l.toNode)   as number,
    }));

    // removeNode의 포트/커넥션을 keepNode로 이전
    const mergedPorts = [...keepNode.ports, ...removeNode.ports];
    const mergedConns = [...keepNode.connections, ...removeNode.connections];

    const updatedNodes = network.nodes
        .filter(n => String(n.id) !== String(removeNodeId))
        .map(n => String(n.id) === String(keepNodeId) ? {
            ...n,
            ports: mergedPorts,
            numPort: mergedPorts.length,
            connections: mergedConns,
            numConnection: mergedConns.length,
        } : n);

    return { ...network, nodes: updatedNodes, links: updatedLinks };
}

// ── 링크 분할 (T/Y 교차로 생성) ─────────────────────────────────
function splitLinkInNetwork(
    network: Network,
    link: Link,
    splitCoord: Coordinates,
    ts: number,
): { updatedNetwork: Network; newNodeId: number | string } {
    const l1Id = ts + 10;
    const l2Id = ts + 11;
    const mId  = ts + 12;

    const fromCoord = link.coordinates[0]!;
    const toCoord   = link.coordinates[link.coordinates.length - 1]!;

    // L1: 기존 fromNode → 새 노드 M
    const linkL1 = makeLink(l1Id, link.fromNode, mId, fromCoord, splitCoord,
        link.numLane, link.width, link.maxSpd);
    // L2: 새 노드 M → 기존 toNode
    const linkL2 = makeLink(l2Id, mId, link.toNode, splitCoord, toCoord,
        link.numLane, link.width, link.maxSpd);

    // 노드 M: L1 in-port, L2 out-port, 직진 커넥션
    const inPortL1   = makePort(l1Id, 'in');
    const outPortL2  = makePort(l2Id, 'out');
    const nodeM      = makeNode(mId, splitCoord, [inPortL1, outPortL2]);
    const straightConns = makeConnections(linkL1, linkL2, 'Straight', 0);
    nodeM.connections   = straightConns;
    nodeM.numConnection = straightConns.length;

    // 기존 노드 A, B 포트/커넥션 업데이트
    const updatedNodes = network.nodes.map(n => {
        if (String(n.id) === String(link.fromNode)) {
            return {
                ...n,
                ports: n.ports.map(p =>
                    String(p.linkId) === String(link.id) && p.type === 'out' ? { ...p, linkId: l1Id } : p),
                connections: n.connections.map(c =>
                    String(c.toLink) === String(link.id) ? { ...c, toLink: l1Id } : c),
            };
        }
        if (String(n.id) === String(link.toNode)) {
            return {
                ...n,
                ports: n.ports.map(p =>
                    String(p.linkId) === String(link.id) && p.type === 'in' ? { ...p, linkId: l2Id } : p),
                connections: n.connections.map(c =>
                    String(c.fromLink) === String(link.id) ? { ...c, fromLink: l2Id } : c),
            };
        }
        return n;
    });
    updatedNodes.push(nodeM);

    const updatedLinks = network.links.filter(l => l.id !== link.id).concat([linkL1, linkL2]);

    return {
        updatedNetwork: { ...network, nodes: updatedNodes, links: updatedLinks },
        newNodeId: mId,
    };
}

function makePort(linkId: number | string, type: 'in' | 'out'): Port {
    return {
        featureType: 'ports',
        linkId, direction: 0, type,
    } as Port;
}

function makeNode(id: number | string, coord: Coordinates, ports: Port[] = []): Node {
    return {
        featureType: 'nodes',
        id, type: 'normal',
        numPort: ports.length, numConnection: 0,
        v2x: '', center: '', coordinates: coord,
        ports, connections: [],
    } as Node;
}

// ── 방위각 계산 (WGS84 기준, 0–360°, 북=0, 동=90) ─────────────
function computeBearing(from: Coordinates, to: Coordinates): number {
    const toRad = Math.PI / 180;
    const lat1 = from.lat * toRad, lat2 = to.lat * toRad;
    const dLng = (to.lng - from.lng) * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ── 회전 방향 판별 ──────────────────────────────────────────────
// 서버 Turning enum: Straight / Right_Turn / Left_Turn
// arrivalBearing : 노드에 진입하는 링크의 진행 방향
// departureBearing: 노드에서 출발하는 링크의 진행 방향
type TurningType = 'Straight' | 'Right_Turn' | 'Left_Turn' | 'U_Turn';

function classifyTurning(arrivalBearing: number, departureBearing: number): TurningType {
    let delta = departureBearing - arrivalBearing;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    // |delta| < 45° → 직진, > 135° → U턴, 그 사이 → 좌/우
    if (Math.abs(delta) < 45) return 'Straight';
    if (Math.abs(delta) > 135) return 'U_Turn';
    return delta > 0 ? 'Right_Turn' : 'Left_Turn';
}

// ── 링크의 노드 진입 방위각 (링크 끝부분 기준) ─────────────────
function linkArrivalBearing(link: Link): number {
    const coords = link.coordinates;
    const n = coords.length;
    const from = n >= 2 ? coords[n - 2]! : coords[0]!;
    const to = coords[n - 1]!;
    return computeBearing(from, to);
}

// ── 링크의 노드 출발 방위각 (링크 시작부분 기준) ───────────────
function linkDepartureBearing(link: Link): number {
    const coords = link.coordinates;
    const from = coords[0]!;
    const to = coords.length >= 2 ? coords[1]! : coords[0]!;
    return computeBearing(from, to);
}

// ── 회전 방향별 차선 연결 생성 ──────────────────────────────────
// 차선 번호: 0 = 가장 왼쪽(내측), numLane-1 = 가장 오른쪽(외측)
// S: 1:1 동일 인덱스 / R: 우측(외측) 차선 / L: 좌측(내측) 차선
function makeConnections(
    fromLink: Link,
    toLink: Link,
    turning: TurningType,
    existingCount: number,
): Connection[] {
    const fLanes = fromLink.numLane;
    const tLanes = toLink.numLane;
    const laneWidth = toLink.width / tLanes;
    const ffSpd = Math.min(fromLink.maxSpd, toLink.maxSpd);
    const fromEnd = fromLink.coordinates[fromLink.coordinates.length - 1]!;
    const toStart = toLink.coordinates[0]!;

    const conn = (fromLane: number, toLane: number, idx: number): Connection => ({
        featureType: 'connections' as any,
        id: existingCount + idx,
        fromLink: fromLink.id, fromLane,
        fromLaneCoordinates: fromEnd,
        toLink: toLink.id, toLane,
        toLaneCoordinates: toStart,
        turning,
        length: 0,
        width: laneWidth,
        ffSpd,
        shape: '',
        coordinates: [],
    } as Connection);

    if (turning === 'Straight') {
        // 직진: 동일 인덱스 1:1 매핑
        return Array.from({ length: Math.min(fLanes, tLanes) }, (_, i) => conn(i, i, i));
    }
    if (turning === 'Right_Turn') {
        // 우회전: 우측(외측, 높은 인덱스) 차선
        const count = Math.min(fLanes, tLanes);
        return Array.from({ length: count }, (_, i) =>
            conn(fLanes - 1 - i, tLanes - 1 - i, i)
        );
    }
    if (turning === 'Left_Turn') {
        // 좌회전: 좌측(내측, 낮은 인덱스) 차선
        const count = Math.min(fLanes, tLanes);
        return Array.from({ length: count }, (_, i) => conn(i, i, i));
    }
    // U턴: 가장 우측 1개 차선만
    return [conn(fLanes - 1, tLanes - 1, 0)];
}

const DEFAULT_CELL_LENGTH = 5; // 셀 기본 길이 (m)

function makeLink(
    id: number | string,
    fromNodeId: number | string,
    toNodeId: number | string,
    from: Coordinates,
    to: Coordinates,
    laneCount: number,
    linkWidth: number,
    maxSpd: number,
): Link {
    const length = getDistance([from.lng, from.lat], [to.lng, to.lat]);
    const numCells = Math.max(1, Math.ceil(length / DEFAULT_CELL_LENGTH));

    const lanes: Lane[] = Array.from({ length: laneCount }, (_, i) => {
        // cells는 시뮬레이션 모델 데이터로 서버 저장 포맷에 필요하지만
        // 렌더링 대상이 아니므로 빈 배열로 초기화 (서버 저장 후 서버에서 채워짐)
        const cells: Cell[] = [];
        const segments: Segment[] = [{
            featureType: 'segments',
            id: 0,
            block: false,
            initPoint: 0,
            endPoint: length,
        } as unknown as Segment];
        return {
            featureType: 'lanes' as any,
            id: i, linkRef: id as number,
            leftLaneId: i > 0 ? i - 1 : -1,
            rightLaneId: i < laneCount - 1 ? i + 1 : -1,
            numCell: numCells, rightLC: true, leftLC: true, laneAccessType: null,
            shape: '', coordinates: [from, to], segments, cells,
            laneSource: null as any, laneTarget: null as any,
        };
    });
    return {
        featureType: 'links',
        id, fromNode: fromNodeId, toNode: toNodeId,
        numLane: laneCount, length, width: linkWidth,
        maxSpd, minSpd: 0, ffSpd: maxSpd, waveSpd: 20,
        qmax: 1800, maxVeh: 60, simType: 0, type: 'car',
        layer: '0', stopLine: 0, shape: '',
        coordinates: [from, to], lanes,
    } as Link;
}

// ── 차선 끝점 OL 좌표 계산 (NetworkFeatureLayer 동일 로직) ────────
function getLaneEndpointWgs84(link: Link, laneIdx: number, which: 'source' | 'target'): Coordinates {
    const ol = getLaneEndpointOl(link, laneIdx, which);
    const ll = toLonLat(ol);
    return { lng: ll[0]!, lat: ll[1]! };
}

function getLaneEndpointOl(link: Link, laneIdx: number, which: 'source' | 'target'): Coordinate {
    const c = link.coordinates;
    const p1 = fromLonLat([c[0]!.lng, c[0]!.lat]);
    const p2 = fromLonLat([c[c.length - 1]!.lng, c[c.length - 1]!.lat]);
    const dx = p2[0]! - p1[0]!, dy = p2[1]! - p1[1]!;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;         // 좌측 법선
    const laneWidth = link.width / link.numLane;
    const offset = ((link.numLane - 1) / 2 - laneIdx) * laneWidth;
    const base = which === 'source' ? p1 : p2;
    return [base[0]! + nx * offset, base[1]! + ny * offset];
}

// ── 메인 훅 ──────────────────────────────────────────────────────
export const useNetworkDraw = () => {
    const olMap = useOpenLayersStore((s) => s.map);
    const viewer = useCesiumStore((s) => s.viewer);
    const isActive = useNetworkDrawStore((s) => s.isActive);
    const isConnectionActive = useNetworkDrawStore((s) => s.isConnectionActive);

    // 설정 refs
    const laneCountRef = useRef(useNetworkDrawStore.getState().laneCount);
    const linkWidthRef = useRef(useNetworkDrawStore.getState().linkWidth);
    const maxSpdRef = useRef(useNetworkDrawStore.getState().maxSpd);
    const isBidirectionalRef = useRef(useNetworkDrawStore.getState().isBidirectional);

    // 공유 그리기 상태 refs (OL ↔ Cesium 공유)
    const startOlCoordRef = useRef<Coordinate | null>(null);
    const startNodeIdRef = useRef<number | string | null>(null);
    const startWgs84Ref = useRef<Coordinates | null>(null);
    const snapNodeRef = useRef<Node | null>(null);

    // OL 프리뷰 refs
    const olSrcRef = useRef<VectorSource | null>(null);
    const lastOlCursorRef = useRef<Coordinate | null>(null);
    const renderOlPreviewRef = useRef<((cursor: Coordinate) => void) | null>(null);
    const linkSnapRef = useRef<LinkSnap | null>(null);

    // Cesium 프리뷰 refs
    const cesiumDsRef = useRef<Cesium.CustomDataSource | null>(null);
    const lastCesiumWgs84Ref = useRef<Coordinates | null>(null);

    // finishSegment를 양쪽 effect에서 참조하기 위한 ref
    const finishSegmentRef = useRef<
        ((endOlCoord: Coordinate, endWgs84: Coordinates, snapEnd: Node | null) => void) | null
    >(null);

    // ── 그리기/커넥션 모드 중 Cesium 기본 이벤트 차단 ──────────
    useEffect(() => {
        if (!viewer || (!isActive && !isConnectionActive)) return;
        // Cesium 기본 핸들러의 LEFT_CLICK (엔티티 선택 등) 임시 제거
        const defaultHandler = (viewer as any).cesiumWidget
            ?.screenSpaceEventHandler as Cesium.ScreenSpaceEventHandler | undefined;
        if (!defaultHandler) return;

        const blockedTypes = [
            Cesium.ScreenSpaceEventType.LEFT_CLICK,
            Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
            Cesium.ScreenSpaceEventType.RIGHT_CLICK,
            Cesium.ScreenSpaceEventType.MOUSE_MOVE,
        ] as const;

        const saved = blockedTypes.map(type => ({
            type,
            action: defaultHandler.getInputAction(type),
        }));
        blockedTypes.forEach(type => defaultHandler.removeInputAction(type));

        return () => {
            saved.forEach(({ type, action }) => {
                if (action) defaultHandler.setInputAction(action, type);
            });
        };
    }, [viewer, isActive, isConnectionActive]);

    // ── 설정 변경 → ref 동기화 + 즉시 preview 갱신 ──────────────
    useEffect(() => {
        return useNetworkDrawStore.subscribe((s) => {
            laneCountRef.current = s.laneCount;
            linkWidthRef.current = s.linkWidth;
            maxSpdRef.current = s.maxSpd;
            isBidirectionalRef.current = s.isBidirectional;

            if (!s.isActive) return;
            // OL preview 갱신
            if (lastOlCursorRef.current && renderOlPreviewRef.current) {
                renderOlPreviewRef.current(lastOlCursorRef.current);
            }
            // Cesium preview 갱신
            if (lastCesiumWgs84Ref.current && cesiumDsRef.current && startWgs84Ref.current) {
                updateCesiumPreview(
                    cesiumDsRef.current,
                    lastCesiumWgs84Ref.current,
                    snapNodeRef.current,
                    linkSnapRef.current,
                    startWgs84Ref.current,
                    linkWidthRef.current,
                );
            }
        });
    }, []);

    // ── OL 이벤트 & 프리뷰 ──────────────────────────────────────
    useEffect(() => {
        if (!olMap || !isActive) return;

        const source = new VectorSource();
        olSrcRef.current = source;
        const layer = new VectorLayer({ source, zIndex: OL_PREVIEW_Z });
        olMap.addLayer(layer);
        olMap.getTargetElement().style.cursor = 'crosshair';

        startOlCoordRef.current = null;
        startNodeIdRef.current = null;
        startWgs84Ref.current = null;
        snapNodeRef.current = null;
        lastOlCursorRef.current = null;

        useMessageStore.getState().setMessage({
            type: 'info',
            text: '지도를 클릭하여 도로의 시작점을 설정하세요. (ESC / 우클릭: 취소)',
        });

        // ── OL 공통 렌더링 함수 ──────────────────────────────────
        function renderOlPreview(cursor: Coordinate) {
            const data = useNetworkStore.getState().currentJsonData;
            const nodes = data?.nodes ?? [];
            const links = data?.links ?? [];
            const lonLat = toLonLat(cursor);

            // 스냅 우선순위: 노드 > 링크 > 자유점
            const snapNode = findSnapNode(nodes, lonLat);
            snapNodeRef.current = snapNode;

            const snapLink = findSnapLink(links, cursor, !!snapNode);
            linkSnapRef.current = snapLink;

            let effCoord: Coordinate;
            let snapIndicatorStyle: Style;

            if (snapNode) {
                effCoord = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
                snapIndicatorStyle = snapStyle;
            } else if (snapLink) {
                effCoord = snapLink.coord;
                snapIndicatorStyle = linkSnapStyle;
            } else {
                effCoord = cursor;
                snapIndicatorStyle = endNodePreviewStyle;
            }

            source.clear();

            const endF = new Feature(new Point(effCoord));
            endF.setStyle(snapIndicatorStyle);
            source.addFeature(endF);

            if (startOlCoordRef.current) {
                const ring = buildRoadPolygon(startOlCoordRef.current, effCoord, linkWidthRef.current / 2);
                if (ring) {
                    const roadF = new Feature(new Polygon([ring]));
                    roadF.setStyle(roadPreviewStyle);
                    source.addFeature(roadF);
                }
                const lineF = new Feature(new LineString([startOlCoordRef.current, effCoord]));
                lineF.setStyle(centerLineStyle);
                source.addFeature(lineF);

                const startF = new Feature(new Point(startOlCoordRef.current));
                startF.setStyle(startNodeStyle);
                source.addFeature(startF);
            }
        }
        renderOlPreviewRef.current = renderOlPreview;

        // ── 구간 완성 (OL·Cesium 공유) ───────────────────────────
        function finishSegment(endOlCoord: Coordinate, endWgs84: Coordinates, snapEnd: Node | null) {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;

            // O(links) 1회 빌드 → 이후 모든 find()를 O(1) Map 룩업으로 대체
            const linkMap = new Map<string, Link>(
                network.links.map(l => [String(l.id), l])
            );

            const ts = Date.now();
            const startWgs84 = startWgs84Ref.current!;
            const linkId = ts + 2;

            // ── fromNode 처리 ──────────────────────────────────
            let fromNodeId: number | string;
            let isNewFromNode = false;
            if (startNodeIdRef.current != null) {
                fromNodeId = startNodeIdRef.current;
            } else {
                fromNodeId = ts;
                isNewFromNode = true;
            }

            // ── toNode 처리 ────────────────────────────────────
            let toNodeId: number | string;
            let isNewToNode = false;
            if (snapEnd) {
                toNodeId = snapEnd.id;
            } else {
                toNodeId = ts + 1;
                isNewToNode = true;
            }

            const newLink = makeLink(
                linkId, fromNodeId, toNodeId,
                startWgs84, endWgs84,
                laneCountRef.current, linkWidthRef.current, maxSpdRef.current,
            );

            // ── 노드 포트/커넥션 업데이트 ─────────────────────
            const outPort = makePort(linkId, 'out');
            const inPort  = makePort(linkId, 'in');

            // 새 링크의 방위각 (fromNode → toNode)
            const newLinkBearing = computeBearing(startWgs84, endWgs84);

            // 기존 노드 배열을 복사하면서 스냅된 노드에 포트 추가
            const updatedNodes = network.nodes.map((n) => {
                if (!isNewFromNode && String(n.id) === String(fromNodeId)) {
                    // fromNode: 기존 "in" 링크 → 새 "out" 링크 커넥션
                    // 진입 방위각(inLink) → 출발 방위각(newLink) 로 S/L/R 판별
                    const inLinks = n.ports
                        .filter(p => p.type === 'in')
                        .map(p => linkMap.get(String(p.linkId)))
                        .filter((l): l is Link => !!l);

                    const newConns: Connection[] = [];
                    for (const inLink of inLinks) {
                        const arrival   = linkArrivalBearing(inLink);
                        const turning   = classifyTurning(arrival, newLinkBearing);
                        if (turning === 'U_Turn') continue; // U턴은 생성 안 함
                        newConns.push(...makeConnections(
                            inLink, newLink, turning,
                            n.connections.length + newConns.length,
                        ));
                    }

                    return {
                        ...n,
                        ports: [...n.ports, outPort],
                        numPort: n.numPort + 1,
                        connections: [...n.connections, ...newConns],
                        numConnection: n.numConnection + newConns.length,
                    };
                }
                if (!isNewToNode && String(n.id) === String(toNodeId)) {
                    // toNode: 새 "in" 링크 → 기존 "out" 링크 커넥션
                    // 진입 방위각(newLink) → 출발 방위각(outLink) 로 S/L/R 판별
                    const outLinks = n.ports
                        .filter(p => p.type === 'out')
                        .map(p => linkMap.get(String(p.linkId)))
                        .filter((l): l is Link => !!l);

                    const newConns: Connection[] = [];
                    for (const outLink of outLinks) {
                        const departure = linkDepartureBearing(outLink);
                        const turning   = classifyTurning(newLinkBearing, departure);
                        if (turning === 'U_Turn') continue;
                        newConns.push(...makeConnections(
                            newLink, outLink, turning,
                            n.connections.length + newConns.length,
                        ));
                    }

                    return {
                        ...n,
                        ports: [...n.ports, inPort],
                        numPort: n.numPort + 1,
                        connections: [...n.connections, ...newConns],
                        numConnection: n.numConnection + newConns.length,
                    };
                }
                return n;
            });

            // 새 노드 추가 (포트 포함)
            if (isNewFromNode) {
                updatedNodes.push(makeNode(fromNodeId, startWgs84, [outPort]));
            }
            if (isNewToNode) {
                updatedNodes.push(makeNode(toNodeId, endWgs84, [inPort]));
            }

            // ── 양방향 처리: 역방향 링크 자동 생성 ─────────────────
            const finalLinks = [...network.links, newLink];
            // newLink가 추가된 Map (양방향 섹션의 find를 O(1)로)
            linkMap.set(String(newLink.id), newLink);

            if (isBidirectionalRef.current) {
                const reverseId = ts + 3;
                const reverseLink = makeLink(
                    reverseId, toNodeId, fromNodeId, endWgs84, startWgs84,
                    laneCountRef.current, linkWidthRef.current, maxSpdRef.current,
                );
                const revOutPort = makePort(reverseId, 'out'); // toNodeId → out
                const revInPort  = makePort(reverseId, 'in');  // fromNodeId ← in
                const revDepBearing = computeBearing(endWgs84, startWgs84);
                const revArrBearing = computeBearing(endWgs84, startWgs84);

                for (let i = 0; i < updatedNodes.length; i++) {
                    const n = updatedNodes[i]!;
                    if (String(n.id) === String(toNodeId)) {
                        // toNodeId: add revOutPort + in-links → reverseLink connections
                        const inLinks = n.ports
                            .filter(p => p.type === 'in')
                            .map(p => linkMap.get(String(p.linkId)))
                            .filter((l): l is Link => !!l);
                        const revConns: Connection[] = [];
                        for (const inLink of inLinks) {
                            const turning = classifyTurning(linkArrivalBearing(inLink), revDepBearing);
                            if (turning === 'U_Turn') continue;
                            revConns.push(...makeConnections(inLink, reverseLink, turning, n.connections.length + revConns.length));
                        }
                        updatedNodes[i] = {
                            ...n,
                            ports: [...n.ports, revOutPort],
                            numPort: n.numPort + 1,
                            connections: [...n.connections, ...revConns],
                            numConnection: n.numConnection + revConns.length,
                        };
                    } else if (String(n.id) === String(fromNodeId)) {
                        // fromNodeId: add revInPort + reverseLink → out-links connections
                        const outLinks = n.ports
                            .filter(p => p.type === 'out')
                            .map(p => linkMap.get(String(p.linkId)))
                            .filter((l): l is Link => !!l);
                        const revConns: Connection[] = [];
                        for (const outLink of outLinks) {
                            const turning = classifyTurning(revArrBearing, linkDepartureBearing(outLink));
                            if (turning === 'U_Turn') continue;
                            revConns.push(...makeConnections(reverseLink, outLink, turning, n.connections.length + revConns.length));
                        }
                        updatedNodes[i] = {
                            ...n,
                            ports: [...n.ports, revInPort],
                            numPort: n.numPort + 1,
                            connections: [...n.connections, ...revConns],
                            numConnection: n.numConnection + revConns.length,
                        };
                    }
                }
                finalLinks.push(reverseLink);
            }

            const newNetwork: Network = { ...network, nodes: updatedNodes, links: finalLinks };

            // 신규 객체에 경로 기반 GUID 부여 (기존 객체는 __guid 있으므로 skip)
            assignPropertyToResponseData(newNetwork as any);

            useNetworkStore.getState().setCurrentJsonData(newNetwork);
            useNetworkStore.getState().setChange(true);

            // ── history 로그 ─────────────────────────────────────────────
            const historyEntry: UpdateLogEntry = { added: [], modified: [] };

            // 신규 링크
            const addedLink = newNetwork.links.find(l => String(l.id) === String(linkId));
            if (addedLink) historyEntry.added!.push(...collectAdded(addedLink));

            // 역방향 링크 (양방향)
            if (isBidirectionalRef.current) {
                const reverseId = ts + 3;
                const addedRev = newNetwork.links.find(l => String(l.id) === String(reverseId));
                if (addedRev) historyEntry.added!.push(...collectAdded(addedRev));
            }

            // 신규 노드
            if (isNewFromNode) {
                const addedNode = newNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
                if (addedNode) historyEntry.added!.push(...collectAdded(addedNode));
            } else {
                // 기존 fromNode: 추가된 포트·커넥션 개별 logged
                const oldFN = network.nodes.find(n => String(n.id) === String(fromNodeId));
                const newFN = newNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
                if (oldFN && newFN) {
                    newFN.ports.slice(oldFN.ports.length).forEach(p => historyEntry.added!.push(...collectAdded(p)));
                    newFN.connections.slice(oldFN.connections.length).forEach(c => historyEntry.added!.push(...collectAdded(c)));
                    if (newFN.numPort !== oldFN.numPort)
                        historyEntry.modified!.push({ guid: newFN.__guid!, field: 'numPort', oldValue: oldFN.numPort, newValue: newFN.numPort });
                    if (newFN.numConnection !== oldFN.numConnection)
                        historyEntry.modified!.push({ guid: newFN.__guid!, field: 'numConnection', oldValue: oldFN.numConnection, newValue: newFN.numConnection });
                }
            }
            if (isNewToNode) {
                const addedNode = newNetwork.nodes.find(n => String(n.id) === String(toNodeId));
                if (addedNode) historyEntry.added!.push(...collectAdded(addedNode));
            } else {
                const oldTN = network.nodes.find(n => String(n.id) === String(toNodeId));
                const newTN = newNetwork.nodes.find(n => String(n.id) === String(toNodeId));
                if (oldTN && newTN) {
                    newTN.ports.slice(oldTN.ports.length).forEach(p => historyEntry.added!.push(...collectAdded(p)));
                    newTN.connections.slice(oldTN.connections.length).forEach(c => historyEntry.added!.push(...collectAdded(c)));
                    if (newTN.numPort !== oldTN.numPort)
                        historyEntry.modified!.push({ guid: newTN.__guid!, field: 'numPort', oldValue: oldTN.numPort, newValue: newTN.numPort });
                    if (newTN.numConnection !== oldTN.numConnection)
                        historyEntry.modified!.push({ guid: newTN.__guid!, field: 'numConnection', oldValue: oldTN.numConnection, newValue: newTN.numConnection });
                }
            }

            if (historyEntry.added!.length > 0 || historyEntry.modified!.length > 0) {
                useNetworkHistoryStore.getState().setUpdateLogs(historyEntry);
            }

            useMessageStore.getState().setMessage({
                type: 'info',
                text: `도로 추가 완료 (${laneCountRef.current}차선, ${Math.round(newLink.length)}m). 계속 클릭하거나 우클릭으로 구간 취소.`,
            });

            // 이어 그리기: 끝점을 새 시작점으로
            startOlCoordRef.current = endOlCoord;
            startNodeIdRef.current = toNodeId;
            startWgs84Ref.current = endWgs84;
        }
        finishSegmentRef.current = finishSegment;

        // ── OL 이벤트 핸들러 (capture phase → 다른 핸들러 차단) ──
        let olMoveRafId: number | null = null;
        const onPointerMove = (e: PointerEvent) => {
            e.stopPropagation();
            const coord = olMap.getEventCoordinate(e);
            lastOlCursorRef.current = coord;
            // RAF 스로틀: 프레임당 1회만 snap 계산 + 렌더링
            if (olMoveRafId !== null) return;
            olMoveRafId = requestAnimationFrame(() => {
                olMoveRafId = null;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            });
        };

        const onClick = (e: MouseEvent) => {
            e.stopPropagation();   // 다른 OL 핸들러로 전달 차단
            const snapNode = snapNodeRef.current;
            const snapLink = linkSnapRef.current;

            // ── 끝점 결정 ────────────────────────────────────────
            let chosenOl: Coordinate;
            let chosenWgs84: Coordinates;
            let resolvedSnapNode: Node | null = snapNode;

            if (snapNode) {
                chosenOl    = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
                chosenWgs84 = snapNode.coordinates;
            } else if (snapLink) {
                chosenOl    = snapLink.coord;
                chosenWgs84 = snapLink.wgs84;
            } else {
                chosenOl    = olMap.getEventCoordinate(e);
                const ll    = toLonLat(chosenOl);
                chosenWgs84 = { lng: ll[0]!, lat: ll[1]! };
            }

            // ── 링크 스냅: 기존 링크를 분할하고 교차 노드 생성 ──
            if (!snapNode && snapLink && !startOlCoordRef.current) {
                // 시작점 클릭 시 링크 분할
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const ts = Date.now();
                const { updatedNetwork, newNodeId } = splitLinkInNetwork(
                    network, snapLink.link, chosenWgs84, ts
                );
                useNetworkStore.getState().setCurrentJsonData(updatedNetwork);
                useNetworkStore.getState().setChange(true);

                startOlCoordRef.current  = chosenOl;
                startNodeIdRef.current   = newNodeId;
                startWgs84Ref.current    = chosenWgs84;
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: '링크 분할 완료. 끝점을 클릭하여 도로를 연결하세요.',
                });
                return;
            }

            if (!snapNode && snapLink && startOlCoordRef.current) {
                // 끝점이 기존 링크 위: 분할 후 해당 노드로 연결
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const ts = Date.now();
                const { updatedNetwork, newNodeId } = splitLinkInNetwork(
                    network, snapLink.link, chosenWgs84, ts
                );
                useNetworkStore.getState().setCurrentJsonData(updatedNetwork);
                // finishSegment는 최신 network를 getState로 읽으므로
                // split 후 store가 반영된 뒤에 실행
                const splitNode = updatedNetwork.nodes.find(n => n.id === newNodeId) ?? null;
                finishSegment(chosenOl, chosenWgs84, splitNode);
                return;
            }

            // ── 일반 처리 ─────────────────────────────────────────
            if (!startOlCoordRef.current) {
                startOlCoordRef.current  = chosenOl;
                startNodeIdRef.current   = snapNode?.id ?? null;
                startWgs84Ref.current    = snapNode ? snapNode.coordinates : chosenWgs84;
                useMessageStore.getState().setMessage({
                    type: 'info', text: '끝점을 클릭하여 도로를 완성하세요.',
                });
            } else {
                finishSegment(chosenOl, chosenWgs84, resolvedSnapNode);
            }
        };

        const onContextMenu = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            if (startOlCoordRef.current) {
                startOlCoordRef.current = null;
                startNodeIdRef.current = null;
                startWgs84Ref.current = null;
                source.clear();
                useMessageStore.getState().setMessage({ type: 'info', text: '취소됨. 새 시작점을 클릭하세요.' });
            } else {
                useNetworkDrawStore.getState().setActive(false);
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') useNetworkDrawStore.getState().setActive(false);
        };

        // capture: true → 이벤트가 다른 OL 핸들러에 도달하기 전에 가로챔
        // pointerdown/pointerup도 막아야 OL 내부 interaction이 차단됨
        const blockPointerDown = (e: Event) => e.stopPropagation();
        const vp = olMap.getViewport();
        vp.addEventListener('pointermove', onPointerMove, true);
        vp.addEventListener('pointerdown', blockPointerDown, true);
        vp.addEventListener('pointerup',   blockPointerDown, true);
        vp.addEventListener('click', onClick, true);
        vp.addEventListener('dblclick', blockPointerDown, true);
        vp.addEventListener('contextmenu', onContextMenu, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            if (olMoveRafId !== null) cancelAnimationFrame(olMoveRafId);
            vp.removeEventListener('pointermove', onPointerMove, true);
            vp.removeEventListener('pointerdown', blockPointerDown, true);
            vp.removeEventListener('pointerup',   blockPointerDown, true);
            vp.removeEventListener('click', onClick, true);
            vp.removeEventListener('dblclick', blockPointerDown, true);
            vp.removeEventListener('contextmenu', onContextMenu, true);
            document.removeEventListener('keydown', onKeyDown);
            olMap.removeLayer(layer);
            olSrcRef.current = null;
            renderOlPreviewRef.current = null;
            finishSegmentRef.current = null;
            lastOlCursorRef.current = null;
            olMap.getTargetElement().style.cursor = '';
        };
    }, [olMap, isActive]);

    // ── Cesium 이벤트 & 프리뷰 ──────────────────────────────────
    useEffect(() => {
        if (!viewer || !isActive) return;

        const ds = new Cesium.CustomDataSource('networkDrawPreview');
        viewer.dataSources.add(ds);
        cesiumDsRef.current = ds;

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        // MOUSE_MOVE — pickEllipsoid(수학적 ray-sphere): GPU readback 없음, 즉각 반응
        let cesiumMoveRafId: number | null = null;
        let lastMovePosition: Cesium.Cartesian2 | null = null;
        handler.setInputAction((mv: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
            lastMovePosition = mv.endPosition;
            if (cesiumMoveRafId !== null) return;
            cesiumMoveRafId = requestAnimationFrame(() => {
                cesiumMoveRafId = null;
                if (!lastMovePosition) return;

                // pickEllipsoid: GPU readback 없이 타원체 교점 계산 (빠름)
                const cartesian = viewer.camera.pickEllipsoid(lastMovePosition);
                if (!cartesian) return;

                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const lng = Cesium.Math.toDegrees(carto.longitude);
                const lat = Cesium.Math.toDegrees(carto.latitude);
                const data  = useNetworkStore.getState().currentJsonData;
                const nodes = data?.nodes ?? [];
                const links = data?.links ?? [];

                const snapNode = findSnapNode(nodes, [lng, lat]);
                snapNodeRef.current = snapNode;

                const cursorOl = fromLonLat([lng, lat]);
                const snapLink = findSnapLink(links, cursorOl, !!snapNode);
                linkSnapRef.current = snapLink;

                const endWgs84 = snapNode ? snapNode.coordinates
                               : snapLink  ? snapLink.wgs84
                               : { lng, lat };
                lastCesiumWgs84Ref.current = endWgs84;
                updateCesiumPreview(ds, endWgs84, snapNode, snapLink, startWgs84Ref.current, linkWidthRef.current);
            });
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // LEFT_CLICK
        handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const cartesian = viewer.camera.pickEllipsoid(click.position);
            if (!cartesian) return;

            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lng = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);

            const snapNode = snapNodeRef.current;
            const snapLink = linkSnapRef.current;

            let chosenWgs84: Coordinates;
            if (snapNode)      chosenWgs84 = snapNode.coordinates;
            else if (snapLink) chosenWgs84 = snapLink.wgs84;
            else               chosenWgs84 = { lng, lat };

            const chosenOlCoord = fromLonLat([chosenWgs84.lng, chosenWgs84.lat]);

            // 링크 스냅: 분할 처리
            if (!snapNode && snapLink) {
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const ts = Date.now();
                const { updatedNetwork, newNodeId } = splitLinkInNetwork(
                    network, snapLink.link, chosenWgs84, ts
                );
                useNetworkStore.getState().setCurrentJsonData(updatedNetwork);
                useNetworkStore.getState().setChange(true);

                if (!startOlCoordRef.current) {
                    startOlCoordRef.current = chosenOlCoord;
                    startNodeIdRef.current  = newNodeId;
                    startWgs84Ref.current   = chosenWgs84;
                    useMessageStore.getState().setMessage({
                        type: 'info', text: '링크 분할 완료. 끝점을 클릭하여 도로를 연결하세요.',
                    });
                } else {
                    const splitNode = updatedNetwork.nodes.find(n => n.id === newNodeId) ?? null;
                    finishSegmentRef.current?.(chosenOlCoord, chosenWgs84, splitNode);
                }
                return;
            }

            if (!startOlCoordRef.current) {
                startOlCoordRef.current = chosenOlCoord;
                startNodeIdRef.current  = snapNode?.id ?? null;
                startWgs84Ref.current   = chosenWgs84;
                useMessageStore.getState().setMessage({
                    type: 'info', text: '끝점을 클릭하여 도로를 완성하세요.',
                });
            } else {
                finishSegmentRef.current?.(chosenOlCoord, chosenWgs84, snapNode);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // RIGHT_CLICK
        handler.setInputAction(() => {
            if (startOlCoordRef.current) {
                startOlCoordRef.current = null;
                startNodeIdRef.current = null;
                startWgs84Ref.current = null;
                ds.entities.removeAll();
                olSrcRef.current?.clear();
                useMessageStore.getState().setMessage({ type: 'info', text: '취소됨. 새 시작점을 클릭하세요.' });
            } else {
                useNetworkDrawStore.getState().setActive(false);
            }
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        return () => {
            if (cesiumMoveRafId !== null) cancelAnimationFrame(cesiumMoveRafId);
            handler.destroy();
            viewer.dataSources.remove(ds, true);
            cesiumDsRef.current = null;
            lastCesiumWgs84Ref.current = null;
        };
    }, [viewer, isActive]);

    // ── Connection 그리기 모드 (OL) ──────────────────────────────
    useEffect(() => {
        if (!olMap || !isConnectionActive) return;

        olMap.getTargetElement().style.cursor = 'crosshair';

        // from 선택 상태: { linkId, laneIdx, nodeId }
        type FromSel = { linkId: number | string; laneIdx: number; nodeId: number | string } | null;
        let fromSel: FromSel = null;

        const CLICK_TOL = 15; // px

        // 점 스타일
        const fromDotStyle = (selected: boolean) => new Style({
            image: new CircleStyle({
                radius: selected ? 8 : 6,
                fill: new Fill({ color: selected ? 'rgba(255,80,80,1)' : 'rgba(220,60,60,0.75)' }),
                stroke: new Stroke({ color: '#fff', width: selected ? 2.5 : 1.5 }),
            }),
        });
        const toDotStyle = new Style({
            image: new CircleStyle({
                radius: 6,
                fill: new Fill({ color: 'rgba(60,130,255,0.75)' }),
                stroke: new Stroke({ color: '#fff', width: 1.5 }),
            }),
        });

        const dotSource = new VectorSource();
        const dotLayer = new VectorLayer({ source: dotSource, zIndex: OL_PREVIEW_Z });
        olMap.addLayer(dotLayer);

        function rebuildDots() {
            dotSource.clear();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;

            if (!fromSel) {
                // from 미선택: 빨간 점만 표시 (모든 링크 진입 끝점)
                for (const link of network.links) {
                    for (let i = 0; i < link.numLane; i++) {
                        const coord = getLaneEndpointOl(link, i, 'target');
                        const f = new Feature(new Point(coord));
                        f.setStyle(fromDotStyle(false));
                        f.set('dotType', 'from');
                        f.set('linkId', link.id);
                        f.set('laneIdx', i);
                        f.set('nodeId', link.toNode);
                        dotSource.addFeature(f);
                    }
                }
            } else {
                // from 선택됨: 선택된 from 강조 + 모든 링크의 파란 점 표시 (다른 노드면 자동 병합)
                for (const link of network.links) {
                    // 선택된 from 차선 강조 표시
                    if (link.id === fromSel.linkId) {
                        const coord = getLaneEndpointOl(link, fromSel.laneIdx, 'target');
                        const f = new Feature(new Point(coord));
                        f.setStyle(fromDotStyle(true));
                        f.set('dotType', 'from');
                        f.set('linkId', link.id);
                        f.set('laneIdx', fromSel.laneIdx);
                        f.set('nodeId', link.toNode);
                        dotSource.addFeature(f);
                    }

                    // 모든 링크의 출발 차선 파란 점 (fromLink 제외)
                    if (link.id !== fromSel.linkId) {
                        for (let i = 0; i < link.numLane; i++) {
                            const coord = getLaneEndpointOl(link, i, 'source');
                            const f = new Feature(new Point(coord));
                            f.setStyle(toDotStyle);
                            f.set('dotType', 'to');
                            f.set('linkId', link.id);
                            f.set('laneIdx', i);
                            f.set('nodeId', link.fromNode);
                            dotSource.addFeature(f);
                        }
                    }
                }
            }
        }
        rebuildDots();

        const onClick = (e: MouseEvent) => {
            e.stopPropagation();   // 다른 OL 핸들러로 전달 차단
            // 픽셀 tolerance 내 가장 가까운 feature 선택
            const hit = olMap.getFeaturesAtPixel(olMap.getEventPixel(e), { hitTolerance: CLICK_TOL })
                .filter(f => f.get('dotType')) as Feature[];
            if (hit.length === 0) return;

            // 클릭 지점에서 가장 가까운 것
            const clickCoord = olMap.getEventCoordinate(e) as Coordinate;
            hit.sort((a, b) => {
                const da = Math.hypot(...(a.getGeometry() as Point).getCoordinates().map((v, i) => v - clickCoord[i]!));
                const db = Math.hypot(...(b.getGeometry() as Point).getCoordinates().map((v, i) => v - clickCoord[i]!));
                return da - db;
            });
            const feat = hit[0]!;
            const dotType = feat.get('dotType') as 'from' | 'to';

            if (dotType === 'from') {
                fromSel = { linkId: feat.get('linkId'), laneIdx: feat.get('laneIdx'), nodeId: feat.get('nodeId') };
                rebuildDots();
                useMessageStore.getState().setMessage({ type: 'info', text: `From: Link ${fromSel.linkId} Lane ${fromSel.laneIdx} 선택됨. 파란 점을 클릭하세요.` });
            } else if (dotType === 'to') {
                if (!fromSel) {
                    useMessageStore.getState().setMessage({ type: 'info', text: '먼저 빨간 점(from 차선)을 클릭하세요.' });
                    return;
                }
                const toNodeId = feat.get('nodeId') as number | string;

                let network = useNetworkStore.getState().currentJsonData;
                if (!network) return;

                const resolvedNodeId: number | string = fromSel.nodeId;
                const isDifferentNode = String(fromSel.nodeId) !== String(toNodeId);

                if (isDifferentNode) {
                    // 다른 노드: 병합 후 교차로 커넥션 자동 재생성
                    network = mergeNodes(network, fromSel.nodeId, toNodeId);
                    network = regenerateNodeConnections(network, resolvedNodeId);
                    useNetworkStore.getState().setCurrentJsonData(network);
                    useNetworkStore.getState().setChange(true);
                    useMessageStore.getState().setMessage({
                        type: 'info', text: '교차로 생성 완료: 노드 병합 후 커넥션 자동 생성',
                    });
                    fromSel = null;
                    rebuildDots();
                    return;
                }

                // 같은 노드: 차선 단위 수동 connection 생성
                const fromLink = network.links.find(l => String(l.id) === String(fromSel!.linkId));
                const toLink   = network.links.find(l => String(l.id) === String(feat.get('linkId')));
                const node     = network.nodes.find(n => String(n.id) === String(resolvedNodeId));
                if (!fromLink || !toLink || !node) return;

                const arrival   = linkArrivalBearing(fromLink);
                const departure = linkDepartureBearing(toLink);
                const turning   = classifyTurning(arrival, departure);
                if (turning === 'U_Turn') {
                    useMessageStore.getState().setMessage({ type: 'error', text: 'U턴 connection은 지원하지 않습니다.' });
                    return;
                }

                const fromLane  = fromSel.laneIdx;
                const toLane    = feat.get('laneIdx') as number;
                const laneWidth = toLink.width / toLink.numLane;
                const newConn: Connection = {
                    featureType: 'connections' as any,
                    id: node.connections.length,
                    fromLink: fromLink.id, fromLane,
                    fromLaneCoordinates: fromLink.coordinates[fromLink.coordinates.length - 1]!,
                    toLink: toLink.id, toLane,
                    toLaneCoordinates: toLink.coordinates[0]!,
                    turning, length: 0, width: laneWidth,
                    ffSpd: Math.min(fromLink.maxSpd, toLink.maxSpd),
                    shape: '', coordinates: [],
                } as Connection;

                const updatedNodesOL = network.nodes.map(n =>
                    String(n.id) === String(resolvedNodeId)
                        ? { ...n, connections: [...n.connections, newConn], numConnection: n.numConnection + 1 }
                        : n
                );
                const connNetworkOL: Network = { ...network, nodes: updatedNodesOL };
                assignPropertyToResponseData(connNetworkOL as any);

                useNetworkStore.getState().setCurrentJsonData(connNetworkOL);
                useNetworkStore.getState().setChange(true);

                // history
                const addedNodeOL = connNetworkOL.nodes.find(n => String(n.id) === String(resolvedNodeId));
                const addedConnOL = addedNodeOL?.connections[addedNodeOL.connections.length - 1];
                if (addedConnOL && addedNodeOL) {
                    useNetworkHistoryStore.getState().setUpdateLogs({
                        added: collectAdded(addedConnOL),
                        modified: [{
                            guid: addedNodeOL.__guid!, field: 'numConnection',
                            oldValue: node.connections.length,
                            newValue: node.connections.length + 1,
                        }],
                    });
                }

                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `Connection 생성: Link ${fromLink.id} Lane ${fromLane} → Link ${toLink.id} Lane ${toLane} (${turning})`,
                });

                fromSel = null;
                rebuildDots();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (fromSel) {
                    fromSel = null;
                    rebuildDots();
                    useMessageStore.getState().setMessage({ type: 'info', text: 'From 선택 취소. 빨간 점을 다시 클릭하세요.' });
                } else {
                    useNetworkDrawStore.getState().setConnectionActive(false);
                }
            }
        };

        const blockPointerDown = (e: Event) => e.stopPropagation();
        const vp = olMap.getViewport();
        vp.addEventListener('pointermove', blockPointerDown, true);
        vp.addEventListener('pointerdown', blockPointerDown, true);
        vp.addEventListener('pointerup',   blockPointerDown, true);
        vp.addEventListener('click', onClick, true);
        vp.addEventListener('dblclick', blockPointerDown, true);
        vp.addEventListener('contextmenu', blockPointerDown, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            vp.removeEventListener('pointermove', blockPointerDown, true);
            vp.removeEventListener('pointerdown', blockPointerDown, true);
            vp.removeEventListener('pointerup',   blockPointerDown, true);
            vp.removeEventListener('click', onClick, true);
            vp.removeEventListener('dblclick', blockPointerDown, true);
            vp.removeEventListener('contextmenu', blockPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
            olMap.removeLayer(dotLayer);
            olMap.getTargetElement().style.cursor = '';
        };
    }, [olMap, isConnectionActive]);

    // ── Connection 그리기 모드 (Cesium) ─────────────────────────
    useEffect(() => {
        if (!viewer || !isConnectionActive) return;

        type FromSel = { linkId: number | string; laneIdx: number; nodeId: number | string } | null;
        let fromSel: FromSel = null;

        const ds = new Cesium.CustomDataSource('connectionDraw');
        viewer.dataSources.add(ds);

        function rebuildDots() {
            ds.entities.removeAll();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;

            if (!fromSel) {
                for (const link of network.links) {
                    for (let i = 0; i < link.numLane; i++) {
                        const wgs84 = getLaneEndpointWgs84(link, i, 'target');
                        ds.entities.add({
                            id: JSON.stringify({ dotType: 'from', linkId: link.id, laneIdx: i, nodeId: link.toNode }),
                            position: Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat),
                            point: {
                                pixelSize: 10,
                                color: Cesium.Color.fromCssColorString('rgba(220,60,60,0.85)'),
                                outlineColor: Cesium.Color.WHITE,
                                outlineWidth: 1.5,
                                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                            },
                        } as any);
                    }
                }
            } else {
                const fromLink = network.links.find(l => String(l.id) === String(fromSel!.linkId));
                if (fromLink) {
                    const wgs84 = getLaneEndpointWgs84(fromLink, fromSel.laneIdx, 'target');
                    ds.entities.add({
                        id: JSON.stringify({ dotType: 'from', linkId: fromLink.id, laneIdx: fromSel.laneIdx, nodeId: fromLink.toNode }),
                        position: Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat),
                        point: {
                            pixelSize: 12,
                            color: Cesium.Color.fromCssColorString('rgba(255,80,80,1)'),
                            outlineColor: Cesium.Color.WHITE,
                            outlineWidth: 2.5,
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                    } as any);
                }
                // 모든 링크의 출발 차선 파란 점 (fromLink 제외)
                for (const link of network.links) {
                    if (link.id !== fromSel!.linkId) {
                        for (let i = 0; i < link.numLane; i++) {
                            const wgs84 = getLaneEndpointWgs84(link, i, 'source');
                            ds.entities.add({
                                id: JSON.stringify({ dotType: 'to', linkId: link.id, laneIdx: i, nodeId: link.fromNode }),
                                position: Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat),
                                point: {
                                    pixelSize: 10,
                                    color: Cesium.Color.fromCssColorString('rgba(60,130,255,0.85)'),
                                    outlineColor: Cesium.Color.WHITE,
                                    outlineWidth: 1.5,
                                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                                },
                            } as any);
                        }
                    }
                }
            }
        }
        rebuildDots();

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const picked = viewer.scene.pick(click.position);
            if (!picked?.id?.id) return;

            let meta: { dotType: string; linkId: number | string; laneIdx: number; nodeId: number | string };
            try {
                meta = JSON.parse(picked.id.id as string);
            } catch {
                return;
            }

            if (meta.dotType === 'from') {
                fromSel = { linkId: meta.linkId, laneIdx: meta.laneIdx, nodeId: meta.nodeId };
                rebuildDots();
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `From: Link ${fromSel.linkId} Lane ${fromSel.laneIdx} 선택됨. 파란 점을 클릭하세요.`,
                });
            } else if (meta.dotType === 'to') {
                if (!fromSel) {
                    useMessageStore.getState().setMessage({ type: 'info', text: '먼저 빨간 점(from 차선)을 클릭하세요.' });
                    return;
                }

                let network = useNetworkStore.getState().currentJsonData;
                if (!network) return;

                const resolvedNodeId: number | string = fromSel.nodeId;
                const isDifferentNode = String(fromSel.nodeId) !== String(meta.nodeId);

                if (isDifferentNode) {
                    // 다른 노드: 병합 후 교차로 커넥션 자동 재생성
                    network = mergeNodes(network, fromSel.nodeId, meta.nodeId);
                    network = regenerateNodeConnections(network, resolvedNodeId);
                    useNetworkStore.getState().setCurrentJsonData(network);
                    useNetworkStore.getState().setChange(true);
                    useMessageStore.getState().setMessage({
                        type: 'info', text: '교차로 생성 완료: 노드 병합 후 커넥션 자동 생성',
                    });
                    fromSel = null;
                    rebuildDots();
                    return;
                }

                // 같은 노드: 차선 단위 수동 connection 생성
                const fromLink = network.links.find(l => String(l.id) === String(fromSel!.linkId));
                const toLink   = network.links.find(l => String(l.id) === String(meta.linkId));
                const node     = network.nodes.find(n => String(n.id) === String(resolvedNodeId));
                if (!fromLink || !toLink || !node) return;

                const arrival   = linkArrivalBearing(fromLink);
                const departure = linkDepartureBearing(toLink);
                const turning   = classifyTurning(arrival, departure);
                if (turning === 'U_Turn') {
                    useMessageStore.getState().setMessage({ type: 'error', text: 'U턴 connection은 지원하지 않습니다.' });
                    return;
                }

                const fromLane  = fromSel.laneIdx;
                const toLane    = meta.laneIdx as number;
                const laneWidth = toLink.width / toLink.numLane;
                const newConn: Connection = {
                    featureType: 'connections' as any,
                    id: node.connections.length,
                    fromLink: fromLink.id, fromLane,
                    fromLaneCoordinates: fromLink.coordinates[fromLink.coordinates.length - 1]!,
                    toLink: toLink.id, toLane,
                    toLaneCoordinates: toLink.coordinates[0]!,
                    turning, length: 0, width: laneWidth,
                    ffSpd: Math.min(fromLink.maxSpd, toLink.maxSpd),
                    shape: '', coordinates: [],
                } as Connection;

                const updatedNodes2 = network.nodes.map(n =>
                    String(n.id) === String(resolvedNodeId)
                        ? { ...n, connections: [...n.connections, newConn], numConnection: n.numConnection + 1 }
                        : n
                );
                const connNetwork2: Network = { ...network, nodes: updatedNodes2 };
                assignPropertyToResponseData(connNetwork2 as any);

                useNetworkStore.getState().setCurrentJsonData(connNetwork2);
                useNetworkStore.getState().setChange(true);

                // history
                const addedNode2 = connNetwork2.nodes.find(n => String(n.id) === String(resolvedNodeId));
                const addedConn2 = addedNode2?.connections[addedNode2.connections.length - 1];
                if (addedConn2 && addedNode2) {
                    useNetworkHistoryStore.getState().setUpdateLogs({
                        added: collectAdded(addedConn2),
                        modified: [{
                            guid: addedNode2.__guid!, field: 'numConnection',
                            oldValue: node.connections.length,
                            newValue: node.connections.length + 1,
                        }],
                    });
                }

                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `Connection 생성: Link ${fromLink.id} Lane ${fromLane} → Link ${toLink.id} Lane ${toLane} (${turning})`,
                });

                fromSel = null;
                rebuildDots();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (fromSel) {
                    fromSel = null;
                    rebuildDots();
                    useMessageStore.getState().setMessage({ type: 'info', text: 'From 선택 취소. 빨간 점을 다시 클릭하세요.' });
                } else {
                    useNetworkDrawStore.getState().setConnectionActive(false);
                }
            }
        };
        document.addEventListener('keydown', onKeyDown);

        return () => {
            handler.destroy();
            viewer.dataSources.remove(ds, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [viewer, isConnectionActive]);
};

// ── Cesium 프리뷰 렌더링 (effect 외부 순수 함수) ─────────────────
function updateCesiumPreview(
    ds: Cesium.CustomDataSource,
    endWgs84: Coordinates,
    snapNode: Node | null,
    snapLink: LinkSnap | null,
    startWgs84: Coordinates | null,
    linkWidth: number,
) {
    ds.entities.removeAll();

    const endPos = Cesium.Cartesian3.fromDegrees(endWgs84.lng, endWgs84.lat);

    // 스냅 인디케이터
    if (snapNode) {
        ds.entities.add({
            id: 'snap',
            position: endPos,
            ellipse: {
                semiMajorAxis: 10,
                semiMinorAxis: 10,
                material: Cesium.Color.fromCssColorString('rgba(0,230,150,0.25)'),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('rgba(0,230,150,1)'),
                outlineWidth: 2,
                height: 0.1,
            },
        } as any);
    } else if (snapLink) {
        ds.entities.add({
            id: 'linkSnap',
            position: endPos,
            ellipse: {
                semiMajorAxis: 10,
                semiMinorAxis: 10,
                material: Cesium.Color.fromCssColorString('rgba(255,165,0,0.2)'),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('rgba(255,165,0,1)'),
                outlineWidth: 2.5,
                height: 0.1,
            },
        } as any);
    } else {
        ds.entities.add({
            id: 'cursor',
            position: endPos,
            point: {
                pixelSize: 8,
                color: Cesium.Color.WHITE.withAlpha(0.8),
                outlineColor: Cesium.Color.fromCssColorString('rgba(65,105,225,0.9)'),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        } as any);
    }

    // 도로 프리뷰
    if (startWgs84) {
        const startPos = Cesium.Cartesian3.fromDegrees(startWgs84.lng, startWgs84.lat);
        ds.entities.add({
            id: 'road',
            corridor: {
                positions: [startPos, endPos],
                width: linkWidth,
                material: Cesium.Color.fromCssColorString('rgba(65,105,225,0.35)'),
                height: 0.05,
                cornerType: Cesium.CornerType.MITERED,
            },
        } as any);

        // 시작점 마커
        ds.entities.add({
            id: 'startNode',
            position: startPos,
            point: {
                pixelSize: 10,
                color: Cesium.Color.fromCssColorString('rgba(65,105,225,1)'),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        } as any);
    }
}
