import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Feature } from 'ol';
import { LineString, Point, Polygon } from 'ol/geom';
import { Stroke, Fill, Style, Circle as CircleStyle, Text as OlText, RegularShape } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Coordinate } from 'ol/coordinate';
import { getDistance } from 'ol/sphere';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useNodeContextMenuStore } from '@stores/useNodeContextMenuStore';
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

// ── OL 프리뷰 스타일 (game-like neon) ───────────────────────────
const roadPreviewStyles = [
    new Style({ stroke: new Stroke({ color: 'rgba(0, 140, 255, 0.12)', width: 28 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(0, 180, 255, 0.25)', width: 16 }) }),
    new Style({
        fill: new Fill({ color: 'rgba(0, 180, 255, 0.10)' }),
        stroke: new Stroke({ color: 'rgba(0, 220, 255, 0.85)', width: 1.5 }),
    }),
];

function getCenterLineStyle(dashOffset: number): Style {
    return new Style({
        stroke: new Stroke({
            color: 'rgba(255, 255, 255, 0.95)',
            width: 1.5,
            lineDash: [8, 6],
            lineDashOffset: dashOffset,
        }),
    });
}

const snapStyle = [
    new Style({
        image: new CircleStyle({
            radius: 20,
            fill: new Fill({ color: 'rgba(0,255,160,0.06)' }),
            stroke: new Stroke({ color: 'rgba(0,255,160,0.35)', width: 1 }),
        }),
    }),
    new Style({
        image: new CircleStyle({
            radius: 13,
            fill: new Fill({ color: 'rgba(0,255,160,0.18)' }),
            stroke: new Stroke({ color: 'rgba(0,255,160,1)', width: 2.5 }),
        }),
    }),
];
const startNodeStyle = [
    new Style({
        image: new CircleStyle({
            radius: 13,
            fill: new Fill({ color: 'rgba(0,220,255,0.12)' }),
            stroke: new Stroke({ color: 'rgba(0,220,255,0.5)', width: 1 }),
        }),
    }),
    new Style({
        image: new CircleStyle({
            radius: 8,
            fill: new Fill({ color: 'rgba(0,220,255,1)' }),
            stroke: new Stroke({ color: '#fff', width: 2.5 }),
        }),
    }),
];
const endNodePreviewStyle = new Style({
    image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: 'rgba(255,255,255,0.9)' }),
        stroke: new Stroke({ color: 'rgba(0,220,255,1)', width: 2 }),
    }),
});
const linkSnapStyle = [
    new Style({
        image: new CircleStyle({
            radius: 18,
            fill: new Fill({ color: 'rgba(255,200,0,0.06)' }),
            stroke: new Stroke({ color: 'rgba(255,200,0,0.3)', width: 1 }),
        }),
    }),
    new Style({
        image: new CircleStyle({
            radius: 12,
            fill: new Fill({ color: 'rgba(255,200,0,0.15)' }),
            stroke: new Stroke({ color: 'rgba(255,200,0,1)', width: 2.5 }),
        }),
    }),
];

// ── CAD 가이드 스타일 ──────────────────────────────────────────
// 노드 정렬 레이: 기존 링크 방향의 확장선
const alignRayStyle = new Style({
    stroke: new Stroke({ color: 'rgba(0, 220, 255, 0.40)', width: 1, lineDash: [4, 7] }),
});
// Shift 각도 고정 가이드 라인
const angleLockStyle = new Style({
    stroke: new Stroke({ color: 'rgba(255, 220, 0, 0.70)', width: 1.2, lineDash: [8, 5] }),
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
export function createIntersectionAtNode(nodeId: number | string): void {
    const network = useNetworkStore.getState().currentJsonData;
    if (!network) return;
    const updated = regenerateNodeConnections(network, nodeId);
    assignPropertyToResponseData(updated as any);
    useNetworkStore.getState().setCurrentJsonData(updated);
    useNetworkStore.getState().setChange(true);
}

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

// ── OL 우클릭 시 노드 탐색 (줌 레벨 무관, 해상도 기반) ─────────────
function findNearestNodeForContextMenu(
    olMap: import('ol').Map,
    e: MouseEvent,
    network: import('@type/Network').Network,
): Node | null {
    const pixel = olMap.getEventPixel(e);
    const coord = olMap.getCoordinateFromPixel(pixel);
    if (!coord) return null;
    const resolution = olMap.getView().getResolution() ?? 1;
    const threshold = resolution * 30; // 30픽셀 상당 지도 단위 거리
    let nearestNode: Node | null = null;
    let minDist = threshold;
    for (const n of network.nodes) {
        const nc = fromLonLat([n.coordinates.lng, n.coordinates.lat]);
        const d = Math.hypot(nc[0]! - coord[0]!, nc[1]! - coord[1]!);
        if (d < minDist) { minDist = d; nearestNode = n; }
    }
    return nearestNode;
}

// ── 메인 훅 ──────────────────────────────────────────────────────
export const useNetworkDraw = () => {
    const olMap = useOpenLayersStore((s) => s.map);
    const viewer = useCesiumStore((s) => s.viewer);
    const isActive = useNetworkDrawStore((s) => s.isActive);
    const isConnectionActive = useNetworkDrawStore((s) => s.isConnectionActive);
    const drawResetKey = useNetworkDrawStore((s) => s.drawResetKey);

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
    const shiftRef = useRef(false);  // Shift 키 각도 스냅 활성 여부

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

    // ── Shift 각도 스냅: 15° 단위로 OL 좌표 제한 ────────────────
    function applyAngleSnapOl(cursor: Coordinate, start: Coordinate): Coordinate {
        const dx = cursor[0]! - start[0]!;
        const dy = cursor[1]! - start[1]!;
        const angle = Math.atan2(dy, dx);
        const STEP = Math.PI / 12; // 15°
        const snapped = Math.round(angle / STEP) * STEP;
        const d = Math.hypot(dx, dy);
        return [start[0]! + d * Math.cos(snapped), start[1]! + d * Math.sin(snapped)];
    }

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
                    shiftRef.current,
                );
            }
        });
    }, []);

    // ── 항상 활성: OL 우클릭 → 노드 컨텍스트 메뉴 ───────────────
    useEffect(() => {
        if (!olMap) return;
        const viewport = olMap.getViewport();

        const onContextMenuAlways = (e: MouseEvent) => {
            const drawState = useNetworkDrawStore.getState();
            if (drawState.isActive || drawState.isConnectionActive || drawState.isSelectActive) return;
            e.preventDefault();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const node = findNearestNodeForContextMenu(olMap, e, network);
            if (node) {
                useNodeContextMenuStore.getState().show(e.clientX, e.clientY, node.id);
            }
        };
        viewport.addEventListener('contextmenu', onContextMenuAlways);
        return () => viewport.removeEventListener('contextmenu', onContextMenuAlways);
    }, [olMap]);

    // ── 항상 활성: Cesium 우클릭 → 노드 컨텍스트 메뉴 ────────────
    useEffect(() => {
        if (!viewer) return;
        const canvas = viewer.canvas;
        const onCesiumContextMenu = (e: MouseEvent) => {
            const drawState = useNetworkDrawStore.getState();
            if (drawState.isActive || drawState.isConnectionActive || drawState.isSelectActive) return;
            e.preventDefault();
            // Cesium pick: 클릭한 위치의 엔티티 확인
            const rect = canvas.getBoundingClientRect();
            const pickPos = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
            const picked = viewer.scene.pick(pickPos);
            if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
                const props = picked.id.properties?.getValue(Cesium.JulianDate.now());
                if (props?.featureType === 'nodes' && props?.id != null) {
                    useNodeContextMenuStore.getState().show(e.clientX, e.clientY, props.id);
                    return;
                }
            }
            // 엔티티 미감지 시 지형 좌표 기반 노드 탐색
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const cartesian = viewer.scene.camera.pickEllipsoid(pickPos, viewer.scene.globe.ellipsoid);
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lng = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const altitude = viewer.camera.positionCartographic.height;
            const threshold = Math.max(SNAP_RADIUS_M, altitude * 0.015);
            let nearestNode: Node | null = null;
            let minDist = threshold;
            for (const n of network.nodes) {
                const d = getDistance([n.coordinates.lng, n.coordinates.lat], [lng, lat]);
                if (d < minDist) { minDist = d; nearestNode = n; }
            }
            if (nearestNode) {
                useNodeContextMenuStore.getState().show(e.clientX, e.clientY, nearestNode.id);
            }
        };
        canvas.addEventListener('contextmenu', onCesiumContextMenu);
        return () => canvas.removeEventListener('contextmenu', onCesiumContextMenu);
    }, [viewer]);

    // ── OL 이벤트 & 프리뷰 ──────────────────────────────────────
    useEffect(() => {
        if (!olMap || !isActive) return;

        const source = new VectorSource();
        olSrcRef.current = source;
        const layer = new VectorLayer({ source, zIndex: OL_PREVIEW_Z });
        olMap.addLayer(layer);
        olMap.getTargetElement().style.cursor = 'crosshair';

        startOlCoordRef.current = null;
        startNodeIdRef.current  = null;
        startWgs84Ref.current   = null;
        snapNodeRef.current = null;
        lastOlCursorRef.current = null;

        // 교차로 지정 후 자동 시작점 설정 (outPort 없는 노드에서 draw 시작)
        const pendingId = useNetworkDrawStore.getState().pendingStartNodeId;
        if (pendingId !== null) {
            useNetworkDrawStore.getState().clearPendingStart();
            const data = useNetworkStore.getState().currentJsonData;
            const pendingNode = data?.nodes.find(n => String(n.id) === pendingId);
            if (pendingNode) {
                const olCoord = fromLonLat([pendingNode.coordinates.lng, pendingNode.coordinates.lat]);
                startOlCoordRef.current  = olCoord;
                startNodeIdRef.current   = pendingNode.id;
                startWgs84Ref.current    = pendingNode.coordinates;
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `교차로 노드(${pendingId}) 시작 설정됨. 연결할 끝점을 클릭하세요.`,
                });
            } else {
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: '지도를 클릭하여 도로의 시작점을 설정하세요. (ESC / 우클릭: 취소)',
                });
            }
        } else {
            useMessageStore.getState().setMessage({
                type: 'info',
                text: '지도를 클릭하여 도로의 시작점을 설정하세요. (ESC / 우클릭: 취소)',
            });
        }

        // ── OL 공통 렌더링 함수 ──────────────────────────────────
        let dashOffset = 0;
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
            let snapIndicatorStyles: Style | Style[];

            if (snapNode) {
                effCoord = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
                snapIndicatorStyles = snapStyle;
            } else if (snapLink) {
                effCoord = snapLink.coord;
                snapIndicatorStyles = linkSnapStyle;
            } else {
                // Shift 각도 스냅: 시작점이 있을 때 15° 단위로 제한
                effCoord = (shiftRef.current && startOlCoordRef.current)
                    ? applyAngleSnapOl(cursor, startOlCoordRef.current)
                    : cursor;
                snapIndicatorStyles = endNodePreviewStyle;
            }

            source.clear();

            // ── ① 노드 정렬 가이드 레이 (snapNode 시 연결 링크 방향 확장선) ──
            if (snapNode) {
                const nodeOl = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
                const RAY_LEN = 200; // 200m (EPSG:3857 ≈ m)
                for (const link of links) {
                    const isFrom = String(link.fromNode) === String(snapNode.id);
                    const isTo   = String(link.toNode)   === String(snapNode.id);
                    if (!isFrom && !isTo) continue;
                    const c = link.coordinates;
                    const otherWgs84 = isFrom
                        ? (c.length > 1 ? c[1]! : c[0]!)
                        : (c.length > 1 ? c[c.length - 2]! : c[0]!);
                    const otherOl = fromLonLat([otherWgs84.lng, otherWgs84.lat]);
                    const dx = otherOl[0]! - nodeOl[0]!;
                    const dy = otherOl[1]! - nodeOl[1]!;
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx / len, uy = dy / len;
                    const rayF = new Feature(new LineString([
                        [nodeOl[0]! - ux * RAY_LEN, nodeOl[1]! - uy * RAY_LEN],
                        [nodeOl[0]! + ux * RAY_LEN, nodeOl[1]! + uy * RAY_LEN],
                    ]));
                    rayF.setStyle(alignRayStyle);
                    source.addFeature(rayF);
                }
            }

            // ── ② Shift 각도 고정 가이드 라인 ──────────────────────────
            if (shiftRef.current && startOlCoordRef.current && !snapNode && !snapLink) {
                const dx = effCoord[0]! - startOlCoordRef.current[0]!;
                const dy = effCoord[1]! - startOlCoordRef.current[1]!;
                const len = Math.hypot(dx, dy) || 1;
                const EXT = 5000;
                const ux = dx / len, uy = dy / len;
                const guidF = new Feature(new LineString([
                    [startOlCoordRef.current[0]! - ux * EXT, startOlCoordRef.current[1]! - uy * EXT],
                    [startOlCoordRef.current[0]! + ux * EXT, startOlCoordRef.current[1]! + uy * EXT],
                ]));
                guidF.setStyle(angleLockStyle);
                source.addFeature(guidF);
            }

            // ── ③ 끝점 인디케이터 ───────────────────────────────────────
            const endF = new Feature(new Point(effCoord));
            endF.setStyle(snapIndicatorStyles as Style);
            source.addFeature(endF);

            if (startOlCoordRef.current) {
                const ring = buildRoadPolygon(startOlCoordRef.current, effCoord, linkWidthRef.current / 2);
                if (ring) {
                    const roadF = new Feature(new Polygon([ring]));
                    roadF.setStyle(roadPreviewStyles as unknown as Style);
                    source.addFeature(roadF);
                }
                const lineF = new Feature(new LineString([startOlCoordRef.current, effCoord]));
                lineF.setStyle(getCenterLineStyle(dashOffset));
                source.addFeature(lineF);

                const startF = new Feature(new Point(startOlCoordRef.current));
                startF.setStyle(startNodeStyle as unknown as Style);
                source.addFeature(startF);

                // ── ④ 거리·방위각·차선 라벨 ──────────────────────────────
                const startLL = toLonLat(startOlCoordRef.current);
                const endLL   = toLonLat(effCoord);
                const dist    = getDistance(startLL, endLL);
                if (dist > 1) {
                    // 방위각 계산 (0=북, 90=동, 시계방향)
                    const dLon = (endLL[0]! - startLL[0]!) * Math.PI / 180;
                    const lat1r = startLL[1]! * Math.PI / 180;
                    const lat2r = endLL[1]! * Math.PI / 180;
                    const bearing = Math.round(
                        ((Math.atan2(
                            Math.sin(dLon) * Math.cos(lat2r),
                            Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon),
                        ) * 180 / Math.PI) + 360) % 360
                    );
                    const lockIcon = shiftRef.current ? ' 🔒' : '';
                    const midX = (startOlCoordRef.current[0]! + effCoord[0]!) / 2;
                    const midY = (startOlCoordRef.current[1]! + effCoord[1]!) / 2;
                    const labelF = new Feature(new Point([midX, midY]));
                    labelF.setStyle(new Style({
                        text: new OlText({
                            text: `${Math.round(dist)}m · ${bearing}° · ${laneCountRef.current}차선${lockIcon}`,
                            font: 'bold 12px monospace',
                            fill: new Fill({ color: shiftRef.current ? '#ffdc00' : '#00dcff' }),
                            stroke: new Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                            offsetY: -14,
                            backgroundFill: new Fill({ color: 'rgba(0,0,0,0.45)' }),
                            padding: [2, 6, 2, 6],
                        }),
                    }));
                    source.addFeature(labelF);
                }
            }
        }
        renderOlPreviewRef.current = renderOlPreview;

        // ── 대시 애니메이션 루프 (~30fps) ───────────────────────────
        const DASH_PATTERN_LEN = 14; // lineDash [8,6] → 합산 14
        const dashAnimInterval = setInterval(() => {
            dashOffset = (dashOffset + 1) % DASH_PATTERN_LEN;
            if (startOlCoordRef.current && lastOlCursorRef.current) {
                renderOlPreview(lastOlCursorRef.current);
            }
        }, 33);

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

            // ── 교차로 지정 노드 자동 병합 & connection 재생성 ──────────
            let autoNetwork = newNetwork;
            const intersectionIds = useNetworkDrawStore.getState().intersectionNodeIds;
            const autoNodeIds: (number | string)[] = [];
            const MERGE_RADIUS_M = 50; // snap 반경(25m)보다 크게: 근접 노드 자동 병합

            // 1) 새로 생성된 fromNode가 교차로 지정 노드 근처이면 병합
            if (isNewFromNode) {
                const newNode = autoNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
                for (const iid of intersectionIds) {
                    if (iid === String(fromNodeId)) continue;
                    const existing = autoNetwork.nodes.find(n => String(n.id) === iid);
                    if (!existing || !newNode) continue;
                    const dist = getDistance(
                        [existing.coordinates.lng, existing.coordinates.lat],
                        [newNode.coordinates.lng,  newNode.coordinates.lat],
                    );
                    if (dist < MERGE_RADIUS_M) {
                        autoNetwork = mergeNodes(autoNetwork, existing.id, fromNodeId);
                        fromNodeId = existing.id;
                        break;
                    }
                }
            }

            // 2) 새로 생성된 toNode가 교차로 지정 노드 근처이면 병합
            if (isNewToNode) {
                const newNode = autoNetwork.nodes.find(n => String(n.id) === String(toNodeId));
                for (const iid of intersectionIds) {
                    if (iid === String(toNodeId)) continue;
                    const existing = autoNetwork.nodes.find(n => String(n.id) === iid);
                    if (!existing || !newNode) continue;
                    const dist = getDistance(
                        [existing.coordinates.lng, existing.coordinates.lat],
                        [newNode.coordinates.lng,  newNode.coordinates.lat],
                    );
                    if (dist < MERGE_RADIUS_M) {
                        autoNetwork = mergeNodes(autoNetwork, existing.id, toNodeId);
                        toNodeId = existing.id;
                        break;
                    }
                }
            }

            // 3) 교차로 지정 노드에서 connection 재생성 (in+out 포트가 모두 있을 때)
            const checkedIds = new Set<string>();
            for (const nid of [fromNodeId, toNodeId]) {
                const sid = String(nid);
                if (checkedIds.has(sid) || !intersectionIds.includes(sid)) continue;
                checkedIds.add(sid);
                const n = autoNetwork.nodes.find(n => String(n.id) === sid);
                if (!n) continue;
                const inOk  = n.ports.some((p: any) => p.type === 'in');
                const outOk = n.ports.some((p: any) => p.type === 'out');
                if (inOk && outOk) {
                    autoNetwork = regenerateNodeConnections(autoNetwork, nid);
                    autoNodeIds.push(nid);
                }
            }
            if (autoNodeIds.length > 0) {
                assignPropertyToResponseData(autoNetwork as any);
            }

            useNetworkStore.getState().setCurrentJsonData(autoNetwork);
            useNetworkStore.getState().setChange(true);

            // ── history 로그 ─────────────────────────────────────────────
            const historyEntry: UpdateLogEntry = { added: [], modified: [] };

            // 신규 링크
            const addedLink = autoNetwork.links.find(l => String(l.id) === String(linkId));
            if (addedLink) historyEntry.added!.push(...collectAdded(addedLink));

            // 역방향 링크 (양방향)
            if (isBidirectionalRef.current) {
                const reverseId = ts + 3;
                const addedRev = autoNetwork.links.find(l => String(l.id) === String(reverseId));
                if (addedRev) historyEntry.added!.push(...collectAdded(addedRev));
            }

            // 신규 노드
            if (isNewFromNode) {
                const addedNode = autoNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
                if (addedNode) historyEntry.added!.push(...collectAdded(addedNode));
            } else {
                const oldFN = network.nodes.find(n => String(n.id) === String(fromNodeId));
                const newFN = autoNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
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
                const addedNode = autoNetwork.nodes.find(n => String(n.id) === String(toNodeId));
                if (addedNode) historyEntry.added!.push(...collectAdded(addedNode));
            } else {
                const oldTN = network.nodes.find(n => String(n.id) === String(toNodeId));
                const newTN = autoNetwork.nodes.find(n => String(n.id) === String(toNodeId));
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

            // connection 생성 결과 메시지
            let resultMsg = `도로 추가 완료 (${laneCountRef.current}차선, ${Math.round(newLink.length)}m)`;
            if (autoNodeIds.length > 0) {
                const totalConns = autoNodeIds.reduce((acc: number, nid) => {
                    return acc + (autoNetwork.nodes.find(n => String(n.id) === String(nid))?.connections.length ?? 0);
                }, 0);
                resultMsg += ` · 교차로 connection ${totalConns}개 자동 생성`;
            } else {
                // 교차로 지정 노드인데 connection이 안 생성된 경우 안내
                const pendingIntersectionNode = [fromNodeId, toNodeId].find(nid =>
                    intersectionIds.includes(String(nid))
                );
                if (pendingIntersectionNode) {
                    const n = autoNetwork.nodes.find(n => String(n.id) === String(pendingIntersectionNode));
                    const hasIn  = n?.ports.some((p: any) => p.type === 'in');
                    const hasOut = n?.ports.some((p: any) => p.type === 'out');
                    if (hasIn && !hasOut) resultMsg += ` · 교차로 노드(${pendingIntersectionNode}) — 나가는 도로 추가 필요`;
                    else if (!hasIn && hasOut) resultMsg += ` · 교차로 노드(${pendingIntersectionNode}) — 들어오는 도로 추가 필요`;
                }
            }
            useMessageStore.getState().setMessage({ type: 'info', text: resultMsg });

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
                chosenOl = olMap.getEventCoordinate(e);
                // Shift 각도 스냅 적용
                if (shiftRef.current && startOlCoordRef.current) {
                    chosenOl = applyAngleSnapOl(chosenOl, startOlCoordRef.current);
                }
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
            e.stopImmediatePropagation(); // 동일 요소의 다른 리스너(always handler) 중복 실행 방지

            const me = e as MouseEvent;
            const network = useNetworkStore.getState().currentJsonData;
            if (network) {
                const node = findNearestNodeForContextMenu(olMap, me, network);
                if (node) {
                    useNodeContextMenuStore.getState().show(me.clientX, me.clientY, node.id);
                    return; // 취소 동작 하지 않음
                }
            }

            // 노드 없음 → 구간 취소 / 그리기 종료
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
            if (e.key === 'Shift') {
                shiftRef.current = true;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
            if (e.key === 'Escape') useNetworkDrawStore.getState().setActive(false);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift') {
                shiftRef.current = false;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
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
        document.addEventListener('keyup', onKeyUp);

        return () => {
            if (olMoveRafId !== null) cancelAnimationFrame(olMoveRafId);
            clearInterval(dashAnimInterval);
            shiftRef.current = false;
            vp.removeEventListener('pointermove', onPointerMove, true);
            vp.removeEventListener('pointerdown', blockPointerDown, true);
            vp.removeEventListener('pointerup',   blockPointerDown, true);
            vp.removeEventListener('click', onClick, true);
            vp.removeEventListener('dblclick', blockPointerDown, true);
            vp.removeEventListener('contextmenu', onContextMenu, true);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            olMap.removeLayer(layer);
            olSrcRef.current = null;
            renderOlPreviewRef.current = null;
            finishSegmentRef.current = null;
            lastOlCursorRef.current = null;
            olMap.getTargetElement().style.cursor = '';
        };
    }, [olMap, isActive, drawResetKey]);

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

                let endWgs84 = snapNode ? snapNode.coordinates
                             : snapLink  ? snapLink.wgs84
                             : { lng, lat };
                // Shift 각도 스냅: 자유점에만 적용
                if (shiftRef.current && startWgs84Ref.current && !snapNode && !snapLink) {
                    const startOl = fromLonLat([startWgs84Ref.current.lng, startWgs84Ref.current.lat]);
                    const endOl   = fromLonLat([endWgs84.lng, endWgs84.lat]);
                    const snappedOl = applyAngleSnapOl(endOl, startOl);
                    const ll = toLonLat(snappedOl);
                    endWgs84 = { lng: ll[0]!, lat: ll[1]! };
                }
                lastCesiumWgs84Ref.current = endWgs84;
                updateCesiumPreview(ds, endWgs84, snapNode, snapLink, startWgs84Ref.current, linkWidthRef.current, shiftRef.current);
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
            else {
                chosenWgs84 = { lng, lat };
                // Shift 각도 스냅 적용
                if (shiftRef.current && startWgs84Ref.current) {
                    const startOl = fromLonLat([startWgs84Ref.current.lng, startWgs84Ref.current.lat]);
                    const endOl   = fromLonLat([chosenWgs84.lng, chosenWgs84.lat]);
                    const snappedOl = applyAngleSnapOl(endOl, startOl);
                    const ll = toLonLat(snappedOl);
                    chosenWgs84 = { lng: ll[0]!, lat: ll[1]! };
                }
            }

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
    }, [viewer, isActive, drawResetKey]);

    // ── Connection 모드: OL ─────────────────────────────────────
    // Phase 1: 전체 노드 표시 → 클릭해서 교차로 진입
    // Phase 2: 선택된 교차로만 표시 → 기존 connection 화살표, from/to 차선 점
    useEffect(() => {
        if (!olMap || !isConnectionActive) return;

        olMap.getTargetElement().style.cursor = 'default';

        const src = new VectorSource();
        const layer = new VectorLayer({ source: src, zIndex: OL_PREVIEW_Z });
        olMap.addLayer(layer);

        type Phase = 'node' | 'edit' | 'lane';
        let phase: Phase = 'node';
        let selectedNodeId: number | string | null = null;
        type FromSel = { linkId: number | string; laneIdx: number } | null;
        let fromSel: FromSel = null;

        const TURN_COLOR: Record<string, string> = {
            Straight:   'rgba(0,220,255,0.85)',
            Right_Turn: 'rgba(255,80,160,0.85)',
            Left_Turn:  'rgba(255,200,0,0.85)',
        };

        // ── Phase 1: 노드 목록 ────────────────────────────────
        function renderNodePhase() {
            src.clear();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;

            for (const node of network.nodes) {
                const inCount  = node.ports?.filter((p: any) => p.type === 'in').length ?? 0;
                const outCount = node.ports?.filter((p: any) => p.type === 'out').length ?? 0;
                if (inCount === 0 && outCount === 0) continue;
                const hasConns = (node.connections?.length ?? 0) > 0;
                const coord = fromLonLat([node.coordinates.lng, node.coordinates.lat]);
                const f = new Feature(new Point(coord));
                f.set('_type', 'node');
                f.set('_nodeId', node.id);
                f.setStyle([
                    new Style({
                        image: new CircleStyle({
                            radius: 13,
                            fill: new Fill({ color: hasConns ? 'rgba(0,180,255,0.12)' : 'rgba(255,120,0,0.12)' }),
                            stroke: new Stroke({ color: hasConns ? 'rgba(0,180,255,0.55)' : 'rgba(255,120,0,0.65)', width: 1.5 }),
                        }),
                    }),
                    new Style({
                        image: new CircleStyle({
                            radius: 6,
                            fill: new Fill({ color: hasConns ? 'rgba(0,220,255,0.9)' : 'rgba(255,150,0,0.9)' }),
                            stroke: new Stroke({ color: '#fff', width: 1.5 }),
                        }),
                        text: new OlText({
                            text: `${node.connections?.length ?? 0}`,
                            font: 'bold 9px monospace',
                            fill: new Fill({ color: '#fff' }),
                            stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 2 }),
                            offsetY: -20,
                        }),
                    }),
                ] as unknown as Style);
                src.addFeature(f);
            }
            useMessageStore.getState().setMessage({
                type: 'info',
                text: '교차로(노드)를 클릭하세요. 파랑=connection 있음, 주황=없음 | [ESC] 종료',
            });
        }

        // ── Phase 2: 교차로 편집 ─────────────────────────────
        function renderEditPhase() {
            src.clear();
            if (!selectedNodeId) return;
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const node = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
            if (!node) return;

            const nodeOl = fromLonLat([node.coordinates.lng, node.coordinates.lat]);
            const inLinks  = node.ports.filter((p: any) => p.type === 'in')
                .map((p: any) => network.links.find((l: any) => String(l.id) === String(p.linkId)))
                .filter((l: any): l is Link => !!l);
            const outLinks = node.ports.filter((p: any) => p.type === 'out')
                .map((p: any) => network.links.find((l: any) => String(l.id) === String(p.linkId)))
                .filter((l: any): l is Link => !!l);

            // 교차로 중심 하이라이트 (클릭으로 돌아가기)
            const nodeF = new Feature(new Point(nodeOl));
            nodeF.set('_type', 'nodeCenter');
            nodeF.setStyle(new Style({
                image: new CircleStyle({
                    radius: 18,
                    fill: new Fill({ color: 'rgba(0,220,255,0.08)' }),
                    stroke: new Stroke({ color: 'rgba(0,220,255,0.7)', width: 2, lineDash: [4, 3] }),
                }),
                text: new OlText({
                    text: '↩',
                    font: 'bold 11px sans-serif',
                    fill: new Fill({ color: 'rgba(0,220,255,0.9)' }),
                    stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 2 }),
                    offsetY: -28,
                }),
            }));
            src.addFeature(nodeF);

            // 기존 connection 화살표 (방향별 색상)
            for (const conn of node.connections) {
                const fromLink = network.links.find((l: any) => String(l.id) === String(conn.fromLink));
                const toLink   = network.links.find((l: any) => String(l.id) === String(conn.toLink));
                if (!fromLink || !toLink) continue;
                const fromOl = getLaneEndpointOl(fromLink, conn.fromLane, 'target');
                const toOl   = getLaneEndpointOl(toLink, conn.toLane, 'source');
                const color  = TURN_COLOR[conn.turning] ?? 'rgba(160,160,160,0.7)';
                const dx = toOl[0]! - fromOl[0]!; const dy = toOl[1]! - fromOl[1]!;
                const angle = Math.atan2(dy, dx);

                const lineF = new Feature(new LineString([fromOl, nodeOl, toOl]));
                lineF.set('_type', 'conn');
                lineF.set('_connId', conn.id);
                lineF.setStyle([
                    new Style({ stroke: new Stroke({ color: color.replace('0.85', '0.12'), width: 6 }) }),
                    new Style({ stroke: new Stroke({ color, width: 1.8, lineDash: [5, 4] }) }),
                ] as unknown as Style);
                src.addFeature(lineF);

                // 화살촉
                const arrowF = new Feature(new Point(toOl));
                arrowF.set('_type', 'connArrow');
                arrowF.setStyle(new Style({
                    image: new RegularShape({
                        points: 3, radius: 6,
                        fill: new Fill({ color }),
                        rotation: -(angle - Math.PI / 2),
                    }),
                    text: new OlText({
                        text: conn.turning === 'Straight' ? '↑' : conn.turning === 'Right_Turn' ? '→' : '←',
                        font: 'bold 9px sans-serif',
                        fill: new Fill({ color }),
                        stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 2 }),
                        offsetY: -14,
                    }),
                }));
                src.addFeature(arrowF);
            }

            // from 차선 점 (빨강, in-link 끝점)
            for (const link of inLinks) {
                for (let i = 0; i < link.numLane; i++) {
                    const coord = getLaneEndpointOl(link, i, 'target');
                    const f = new Feature(new Point(coord));
                    f.set('_type', 'from');
                    f.set('_linkId', link.id);
                    f.set('_laneIdx', i);
                    f.setStyle([
                        new Style({ image: new CircleStyle({ radius: 12, fill: new Fill({ color: 'rgba(255,60,60,0.1)' }), stroke: new Stroke({ color: 'rgba(255,60,60,0.4)', width: 1 }) }) }),
                        new Style({
                            image: new CircleStyle({ radius: 6, fill: new Fill({ color: 'rgba(255,70,70,0.95)' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
                            text: new OlText({ text: `L${i}`, font: 'bold 9px sans-serif', fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 2 }), offsetY: -17 }),
                        }),
                    ] as unknown as Style);
                    src.addFeature(f);
                }
            }

            // to 차선 점 (파랑, out-link 시작점)
            for (const link of outLinks) {
                for (let i = 0; i < link.numLane; i++) {
                    const coord = getLaneEndpointOl(link, i, 'source');
                    const f = new Feature(new Point(coord));
                    f.set('_type', 'to');
                    f.set('_linkId', link.id);
                    f.set('_laneIdx', i);
                    f.setStyle([
                        new Style({ image: new CircleStyle({ radius: 12, fill: new Fill({ color: 'rgba(60,130,255,0.1)' }), stroke: new Stroke({ color: 'rgba(60,130,255,0.4)', width: 1 }) }) }),
                        new Style({
                            image: new CircleStyle({ radius: 6, fill: new Fill({ color: 'rgba(60,130,255,0.95)' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
                            text: new OlText({ text: `L${i}`, font: 'bold 9px sans-serif', fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 2 }), offsetY: -17 }),
                        }),
                    ] as unknown as Style);
                    src.addFeature(f);
                }
            }

            const connCount = node.connections?.length ?? 0;
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `교차로 편집 (connection ${connCount}개) | 빨강→from차선, 파랑→to차선 | [A] 자동완성 | [Del] 전체삭제 | 화살표 클릭=삭제 | [ESC] 뒤로`,
            });
        }

        // ── Phase 3: Lane 선택 강조 추가 ─────────────────────
        function renderLanePhase() {
            renderEditPhase();
            if (!fromSel || !selectedNodeId) return;
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const fromLink = network.links.find((l: any) => String(l.id) === String(fromSel!.linkId));
            if (!fromLink) return;
            const coord = getLaneEndpointOl(fromLink, fromSel.laneIdx, 'target');
            const f = new Feature(new Point(coord));
            f.setStyle(new Style({
                image: new CircleStyle({
                    radius: 9,
                    fill: new Fill({ color: 'rgba(255,60,60,1)' }),
                    stroke: new Stroke({ color: '#ffff00', width: 3 }),
                }),
            }));
            src.addFeature(f);
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `Link ${fromSel.linkId} L${fromSel.laneIdx} 선택됨 → 파란 점(to차선) 클릭 | [ESC] 취소`,
            });
        }

        // ── 자동 connection 생성 ──────────────────────────────
        function autoGenConnections() {
            if (!selectedNodeId) return;
            let network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            network = regenerateNodeConnections(network, selectedNodeId);
            assignPropertyToResponseData(network as any);
            useNetworkStore.getState().setCurrentJsonData(network);
            useNetworkStore.getState().setChange(true);
            renderEditPhase();
            useMessageStore.getState().setMessage({ type: 'info', text: '자동완성: S/L/R connection 생성 완료' });
        }

        renderNodePhase();

        // ── 클릭 이벤트 ──────────────────────────────────────
        const CLICK_TOL = 14;
        const onClick = (e: MouseEvent) => {
            e.stopPropagation();
            const pixel = olMap.getEventPixel(e);
            const clickCoord = olMap.getEventCoordinate(e) as Coordinate;
            const hits = olMap.getFeaturesAtPixel(pixel, { hitTolerance: CLICK_TOL })
                .filter(f => f.get('_type') && f.get('_type') !== 'connArrow') as Feature[];
            if (hits.length === 0) return;

            // Point feature 우선, 가장 가까운 것
            hits.sort((a, b) => {
                const ga = a.getGeometry(); const gb = b.getGeometry();
                const aIsPoint = ga instanceof Point ? 0 : 1;
                const bIsPoint = gb instanceof Point ? 0 : 1;
                if (aIsPoint !== bIsPoint) return aIsPoint - bIsPoint;
                const getCenter = (g: any) => g instanceof Point ? g.getCoordinates() : (g?.getFirstCoordinate?.() ?? [0,0]);
                const ca = getCenter(ga); const cb = getCenter(gb);
                return Math.hypot(ca[0]-clickCoord[0]!, ca[1]-clickCoord[1]!) - Math.hypot(cb[0]-clickCoord[0]!, cb[1]-clickCoord[1]!);
            });

            const feat = hits[0]!;
            const type = feat.get('_type') as string;

            if (phase === 'node' && type === 'node') {
                selectedNodeId = feat.get('_nodeId');
                phase = 'edit';
                fromSel = null;
                renderEditPhase();
                return;
            }

            if (phase === 'edit' || phase === 'lane') {
                if (type === 'nodeCenter') {
                    phase = 'node'; selectedNodeId = null; fromSel = null;
                    renderNodePhase(); return;
                }
                if (type === 'conn') {
                    const connId = feat.get('_connId');
                    let network = useNetworkStore.getState().currentJsonData;
                    if (!network || !selectedNodeId) return;
                    const node = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
                    if (!node) return;
                    const newConns = node.connections.filter((c: any) => c.id !== connId);
                    const updatedNodes = network.nodes.map((n: any) =>
                        String(n.id) === String(selectedNodeId)
                            ? { ...n, connections: newConns, numConnection: newConns.length } : n
                    );
                    const newNetwork: Network = { ...network, nodes: updatedNodes };
                    assignPropertyToResponseData(newNetwork as any);
                    useNetworkStore.getState().setCurrentJsonData(newNetwork);
                    useNetworkStore.getState().setChange(true);
                    fromSel = null; phase = 'edit'; renderEditPhase();
                    useMessageStore.getState().setMessage({ type: 'info', text: 'Connection 삭제됨' });
                    return;
                }
                if (type === 'from') {
                    fromSel = { linkId: feat.get('_linkId'), laneIdx: feat.get('_laneIdx') };
                    phase = 'lane'; renderLanePhase(); return;
                }
                if (type === 'to' && phase === 'lane' && fromSel) {
                    const toLinkId = feat.get('_linkId');
                    const toLane   = feat.get('_laneIdx') as number;
                    let network = useNetworkStore.getState().currentJsonData;
                    if (!network || !selectedNodeId) return;
                    const node     = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
                    const fromLink = network.links.find((l: any) => String(l.id) === String(fromSel!.linkId));
                    const toLink   = network.links.find((l: any) => String(l.id) === String(toLinkId));
                    if (!node || !fromLink || !toLink) return;

                    const turning = classifyTurning(linkArrivalBearing(fromLink), linkDepartureBearing(toLink));
                    if (turning === 'U_Turn') {
                        useMessageStore.getState().setMessage({ type: 'error', text: 'U턴은 지원하지 않습니다.' });
                        return;
                    }
                    const alreadyExists = node.connections.some((c: any) =>
                        String(c.fromLink) === String(fromSel!.linkId) && c.fromLane === fromSel!.laneIdx &&
                        String(c.toLink) === String(toLinkId) && c.toLane === toLane
                    );
                    if (alreadyExists) {
                        useMessageStore.getState().setMessage({ type: 'warn', text: '이미 존재하는 connection입니다.' });
                        fromSel = null; phase = 'edit'; renderEditPhase(); return;
                    }

                    const laneWidth = toLink.width / toLink.numLane;
                    const newConn: Connection = {
                        featureType: 'connections' as any,
                        id: node.connections.length,
                        fromLink: fromLink.id, fromLane: fromSel.laneIdx,
                        fromLaneCoordinates: fromLink.coordinates[fromLink.coordinates.length - 1]!,
                        toLink: toLink.id, toLane,
                        toLaneCoordinates: toLink.coordinates[0]!,
                        turning, length: 0, width: laneWidth,
                        ffSpd: Math.min(fromLink.maxSpd, toLink.maxSpd),
                        shape: '', coordinates: [],
                    } as Connection;

                    const updatedNodes = network.nodes.map((n: any) =>
                        String(n.id) === String(selectedNodeId)
                            ? { ...n, connections: [...n.connections, newConn], numConnection: n.connections.length + 1 } : n
                    );
                    const newNetwork: Network = { ...network, nodes: updatedNodes };
                    assignPropertyToResponseData(newNetwork as any);
                    useNetworkStore.getState().setCurrentJsonData(newNetwork);
                    useNetworkStore.getState().setChange(true);
                    const addedNode = newNetwork.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
                    const addedConn = addedNode?.connections[addedNode.connections.length - 1];
                    if (addedConn && addedNode) {
                        useNetworkHistoryStore.getState().setUpdateLogs({
                            added: collectAdded(addedConn),
                            modified: [{ guid: addedNode.__guid!, field: 'numConnection', oldValue: node.connections.length, newValue: node.connections.length + 1 }],
                        });
                    }
                    fromSel = null; phase = 'edit'; renderEditPhase();
                    useMessageStore.getState().setMessage({ type: 'info', text: `Connection 생성: ${turning}` });
                }
            }
        };

        // ── 키보드 ────────────────────────────────────────────
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (phase === 'lane') { fromSel = null; phase = 'edit'; renderEditPhase(); }
                else if (phase === 'edit') { phase = 'node'; selectedNodeId = null; renderNodePhase(); }
                else { useNetworkDrawStore.getState().setConnectionActive(false); }
            }
            if ((e.key === 'a' || e.key === 'A') && phase === 'edit') autoGenConnections();
            if ((e.key === 'Delete' || e.key === 'Backspace') && phase === 'edit' && selectedNodeId) {
                let network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const updatedNodes = network.nodes.map((n: any) =>
                    String(n.id) === String(selectedNodeId) ? { ...n, connections: [], numConnection: 0 } : n
                );
                const newNetwork: Network = { ...network, nodes: updatedNodes };
                assignPropertyToResponseData(newNetwork as any);
                useNetworkStore.getState().setCurrentJsonData(newNetwork);
                useNetworkStore.getState().setChange(true);
                renderEditPhase();
                useMessageStore.getState().setMessage({ type: 'info', text: '교차로 connection 전체 삭제' });
            }
        };

        const blockPointerDown = (e: Event) => e.stopPropagation();
        const vp = olMap.getViewport();
        vp.addEventListener('pointerdown', blockPointerDown, true);
        vp.addEventListener('pointerup',   blockPointerDown, true);
        vp.addEventListener('click', onClick, true);
        vp.addEventListener('dblclick', blockPointerDown, true);
        vp.addEventListener('contextmenu', blockPointerDown, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            vp.removeEventListener('pointerdown', blockPointerDown, true);
            vp.removeEventListener('pointerup',   blockPointerDown, true);
            vp.removeEventListener('click', onClick, true);
            vp.removeEventListener('dblclick', blockPointerDown, true);
            vp.removeEventListener('contextmenu', blockPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
            olMap.removeLayer(layer);
            olMap.getTargetElement().style.cursor = '';
        };
    }, [olMap, isConnectionActive]);

    // ── Connection 모드: Cesium ─────────────────────────────────
    useEffect(() => {
        if (!viewer || !isConnectionActive) return;

        const ds = new Cesium.CustomDataSource('connectionDraw');
        viewer.dataSources.add(ds);

        type Phase = 'node' | 'edit' | 'lane';
        let phase: Phase = 'node';
        let selectedNodeId: number | string | null = null;
        type FromSel = { linkId: number | string; laneIdx: number } | null;
        let fromSel: FromSel = null;

        const NEON_CYAN = Cesium.Color.fromCssColorString('#00dcff');
        const TURN_CESIUM: Record<string, Cesium.Color> = {
            Straight:   Cesium.Color.fromCssColorString('#00dcff'),
            Right_Turn: Cesium.Color.fromCssColorString('#ff50a0'),
            Left_Turn:  Cesium.Color.fromCssColorString('#ffc800'),
        };

        function renderNodePhase() {
            ds.entities.removeAll();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            for (const node of network.nodes) {
                const inCount  = node.ports?.filter((p: any) => p.type === 'in').length ?? 0;
                const outCount = node.ports?.filter((p: any) => p.type === 'out').length ?? 0;
                if (inCount === 0 && outCount === 0) continue;
                const hasConns = (node.connections?.length ?? 0) > 0;
                ds.entities.add({
                    id: `node_${node.id}`,
                    position: Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat),
                    point: {
                        pixelSize: 14,
                        color: (hasConns ? NEON_CYAN : Cesium.Color.fromCssColorString('#ff9600')).withAlpha(0.9),
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 2,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    },
                    label: {
                        text: `${node.connections?.length ?? 0}c`,
                        font: '10px monospace',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        pixelOffset: new Cesium.Cartesian2(0, -22),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 300),
                    },
                } as any);
            }
        }

        function renderEditPhase() {
            ds.entities.removeAll();
            if (!selectedNodeId) return;
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const node = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
            if (!node) return;

            const nodePos = Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat);
            const inLinks  = node.ports.filter((p: any) => p.type === 'in')
                .map((p: any) => network.links.find((l: any) => String(l.id) === String(p.linkId)))
                .filter((l: any): l is Link => !!l);
            const outLinks = node.ports.filter((p: any) => p.type === 'out')
                .map((p: any) => network.links.find((l: any) => String(l.id) === String(p.linkId)))
                .filter((l: any): l is Link => !!l);

            // 교차로 중심 마커 (클릭 → 뒤로)
            ds.entities.add({
                id: 'nodeCenter',
                position: nodePos,
                ellipse: {
                    semiMajorAxis: 8, semiMinorAxis: 8,
                    material: NEON_CYAN.withAlpha(0.1),
                    outline: true, outlineColor: NEON_CYAN.withAlpha(0.7), outlineWidth: 2,
                    height: 0.1,
                },
            } as any);

            // 기존 connection — PolylineArrow 방향별 색상
            for (const conn of node.connections) {
                const fromLink = network.links.find((l: any) => String(l.id) === String(conn.fromLink));
                const toLink   = network.links.find((l: any) => String(l.id) === String(conn.toLink));
                if (!fromLink || !toLink) continue;
                const fromWgs84 = getLaneEndpointWgs84(fromLink, conn.fromLane, 'target');
                const toWgs84   = getLaneEndpointWgs84(toLink, conn.toLane, 'source');
                const color = TURN_CESIUM[conn.turning] ?? Cesium.Color.GRAY;
                ds.entities.add({
                    id: `conn_${conn.id}`,
                    polyline: {
                        positions: [
                            Cesium.Cartesian3.fromDegrees(fromWgs84.lng, fromWgs84.lat),
                            nodePos,
                            Cesium.Cartesian3.fromDegrees(toWgs84.lng, toWgs84.lat),
                        ],
                        width: 4,
                        material: new Cesium.PolylineArrowMaterialProperty(color.withAlpha(0.85)),
                        clampToGround: true,
                    },
                } as any);
            }

            // from 차선 점 (빨강)
            for (const link of inLinks) {
                for (let i = 0; i < link.numLane; i++) {
                    const wgs84 = getLaneEndpointWgs84(link, i, 'target');
                    ds.entities.add({
                        id: `from_${link.id}_${i}`,
                        position: Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat),
                        point: {
                            pixelSize: 12,
                            color: Cesium.Color.fromCssColorString('rgba(255,70,70,0.95)'),
                            outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        label: {
                            text: `L${i}`,
                            font: 'bold 10px monospace',
                            fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                            pixelOffset: new Cesium.Cartesian2(0, -20),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                    } as any);
                }
            }

            // to 차선 점 (파랑)
            for (const link of outLinks) {
                for (let i = 0; i < link.numLane; i++) {
                    const wgs84 = getLaneEndpointWgs84(link, i, 'source');
                    ds.entities.add({
                        id: `to_${link.id}_${i}`,
                        position: Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat),
                        point: {
                            pixelSize: 12,
                            color: Cesium.Color.fromCssColorString('rgba(60,130,255,0.95)'),
                            outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        label: {
                            text: `L${i}`,
                            font: 'bold 10px monospace',
                            fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                            pixelOffset: new Cesium.Cartesian2(0, -20),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                    } as any);
                }
            }
            try { viewer!.scene.requestRender(); } catch (_) {}
        }

        renderNodePhase();

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const picked = viewer.scene.pick(click.position);
            if (!picked?.id?.id) return;
            const eid = picked.id.id as string;

            if (phase === 'node' && eid.startsWith('node_')) {
                selectedNodeId = eid.replace('node_', '');
                phase = 'edit'; fromSel = null;
                renderEditPhase(); return;
            }

            if (phase === 'edit' || phase === 'lane') {
                if (eid === 'nodeCenter') {
                    phase = 'node'; selectedNodeId = null;
                    renderNodePhase(); return;
                }
                if (eid.startsWith('conn_')) {
                    const connId = Number(eid.replace('conn_', ''));
                    let network = useNetworkStore.getState().currentJsonData;
                    if (!network || !selectedNodeId) return;
                    const node = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
                    if (!node) return;
                    const newConns = node.connections.filter((c: any) => c.id !== connId);
                    const updatedNodes = network.nodes.map((n: any) =>
                        String(n.id) === String(selectedNodeId)
                            ? { ...n, connections: newConns, numConnection: newConns.length } : n
                    );
                    const newNetwork: Network = { ...network, nodes: updatedNodes };
                    assignPropertyToResponseData(newNetwork as any);
                    useNetworkStore.getState().setCurrentJsonData(newNetwork);
                    useNetworkStore.getState().setChange(true);
                    fromSel = null; phase = 'edit'; renderEditPhase();
                    useMessageStore.getState().setMessage({ type: 'info', text: 'Connection 삭제됨' });
                    return;
                }
                if (eid.startsWith('from_')) {
                    const parts = eid.split('_');
                    // id format: from_{linkId}_{laneIdx}  — linkId may contain underscores? use last part as lane
                    const laneIdx = Number(parts[parts.length - 1]);
                    const linkId  = parts.slice(1, parts.length - 1).join('_');
                    fromSel = { linkId, laneIdx };
                    phase = 'lane';
                    // 선택 강조
                    const e = ds.entities.getById(eid);
                    if (e?.point) (e.point as any).color = new Cesium.ConstantProperty(Cesium.Color.YELLOW);
                    useMessageStore.getState().setMessage({ type: 'info', text: `Link ${linkId} L${laneIdx} 선택 → 파란 점 클릭 | [ESC] 취소` });
                    return;
                }
                if (eid.startsWith('to_') && phase === 'lane' && fromSel) {
                    const parts = eid.split('_');
                    const toLane   = Number(parts[parts.length - 1]);
                    const toLinkId = parts.slice(1, parts.length - 1).join('_');
                    let network = useNetworkStore.getState().currentJsonData;
                    if (!network || !selectedNodeId) return;
                    const node     = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
                    const fromLink = network.links.find((l: any) => String(l.id) === String(fromSel!.linkId));
                    const toLink   = network.links.find((l: any) => String(l.id) === String(toLinkId));
                    if (!node || !fromLink || !toLink) return;

                    const turning = classifyTurning(linkArrivalBearing(fromLink), linkDepartureBearing(toLink));
                    if (turning === 'U_Turn') {
                        useMessageStore.getState().setMessage({ type: 'error', text: 'U턴은 지원하지 않습니다.' });
                        return;
                    }
                    const alreadyExists = node.connections.some((c: any) =>
                        String(c.fromLink) === String(fromSel!.linkId) && c.fromLane === fromSel!.laneIdx &&
                        String(c.toLink) === String(toLinkId) && c.toLane === toLane
                    );
                    if (alreadyExists) {
                        useMessageStore.getState().setMessage({ type: 'warn', text: '이미 존재하는 connection' });
                        fromSel = null; phase = 'edit'; renderEditPhase(); return;
                    }

                    const laneWidth = toLink.width / toLink.numLane;
                    const newConn: Connection = {
                        featureType: 'connections' as any,
                        id: node.connections.length,
                        fromLink: fromLink.id, fromLane: fromSel.laneIdx,
                        fromLaneCoordinates: fromLink.coordinates[fromLink.coordinates.length - 1]!,
                        toLink: toLink.id, toLane,
                        toLaneCoordinates: toLink.coordinates[0]!,
                        turning, length: 0, width: laneWidth,
                        ffSpd: Math.min(fromLink.maxSpd, toLink.maxSpd),
                        shape: '', coordinates: [],
                    } as Connection;

                    const updatedNodes = network.nodes.map((n: any) =>
                        String(n.id) === String(selectedNodeId)
                            ? { ...n, connections: [...n.connections, newConn], numConnection: n.connections.length + 1 } : n
                    );
                    const newNetwork: Network = { ...network, nodes: updatedNodes };
                    assignPropertyToResponseData(newNetwork as any);
                    useNetworkStore.getState().setCurrentJsonData(newNetwork);
                    useNetworkStore.getState().setChange(true);
                    const addedNode = newNetwork.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
                    const addedConn = addedNode?.connections[addedNode.connections.length - 1];
                    if (addedConn && addedNode) {
                        useNetworkHistoryStore.getState().setUpdateLogs({
                            added: collectAdded(addedConn),
                            modified: [{ guid: addedNode.__guid!, field: 'numConnection', oldValue: node.connections.length, newValue: node.connections.length + 1 }],
                        });
                    }
                    fromSel = null; phase = 'edit'; renderEditPhase();
                    useMessageStore.getState().setMessage({ type: 'info', text: `Connection 생성: ${turning}` });
                }
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (phase === 'lane') { fromSel = null; phase = 'edit'; renderEditPhase(); }
                else if (phase === 'edit') { phase = 'node'; selectedNodeId = null; renderNodePhase(); }
                else { useNetworkDrawStore.getState().setConnectionActive(false); }
            }
            if ((e.key === 'a' || e.key === 'A') && phase === 'edit' && selectedNodeId) {
                let network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                network = regenerateNodeConnections(network, selectedNodeId);
                assignPropertyToResponseData(network as any);
                useNetworkStore.getState().setCurrentJsonData(network);
                useNetworkStore.getState().setChange(true);
                renderEditPhase();
                useMessageStore.getState().setMessage({ type: 'info', text: '자동완성: S/L/R connection 생성 완료' });
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && phase === 'edit' && selectedNodeId) {
                let network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const updatedNodes = network.nodes.map((n: any) =>
                    String(n.id) === String(selectedNodeId) ? { ...n, connections: [], numConnection: 0 } : n
                );
                const newNetwork: Network = { ...network, nodes: updatedNodes };
                assignPropertyToResponseData(newNetwork as any);
                useNetworkStore.getState().setCurrentJsonData(newNetwork);
                useNetworkStore.getState().setChange(true);
                renderEditPhase();
                useMessageStore.getState().setMessage({ type: 'info', text: '교차로 connection 전체 삭제' });
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

// ── Cesium 프리뷰 렌더링 (effect 외부 순수 함수, game-like neon) ──
function updateCesiumPreview(
    ds: Cesium.CustomDataSource,
    endWgs84: Coordinates,
    snapNode: Node | null,
    snapLink: LinkSnap | null,
    startWgs84: Coordinates | null,
    linkWidth: number,
    shiftActive = false,
) {
    ds.entities.removeAll();

    const endPos = Cesium.Cartesian3.fromDegrees(endWgs84.lng, endWgs84.lat);
    const NEON_CYAN   = Cesium.Color.fromCssColorString('#00dcff');
    const NEON_GREEN  = Cesium.Color.fromCssColorString('#00ff9a');
    const NEON_ORANGE = Cesium.Color.fromCssColorString('#ffcc00');

    // ── 노드 정렬 가이드 레이 (snapNode 시 연결 링크 방향 확장선) ──
    if (snapNode) {
        const nodePos = Cesium.Cartesian3.fromDegrees(snapNode.coordinates.lng, snapNode.coordinates.lat);
        const RAY_M = 150;
        const links = useNetworkStore.getState().currentJsonData?.links ?? [];
        for (const link of links) {
            const isFrom = String(link.fromNode) === String(snapNode.id);
            const isTo   = String(link.toNode)   === String(snapNode.id);
            if (!isFrom && !isTo) continue;
            const c = link.coordinates;
            const otherWgs84 = isFrom
                ? (c.length > 1 ? c[1]! : c[0]!)
                : (c.length > 1 ? c[c.length - 2]! : c[0]!);
            const nodeOl  = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
            const otherOl = fromLonLat([otherWgs84.lng, otherWgs84.lat]);
            const dx = otherOl[0]! - nodeOl[0]!; const dy = otherOl[1]! - nodeOl[1]!;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const backOl  = [nodeOl[0]! - ux * RAY_M, nodeOl[1]! - uy * RAY_M];
            const frontOl = [nodeOl[0]! + ux * RAY_M, nodeOl[1]! + uy * RAY_M];
            const backLL  = toLonLat(backOl);  const frontLL = toLonLat(frontOl);
            ds.entities.add({
                polyline: {
                    positions: [
                        Cesium.Cartesian3.fromDegrees(backLL[0]!, backLL[1]!),
                        nodePos,
                        Cesium.Cartesian3.fromDegrees(frontLL[0]!, frontLL[1]!),
                    ],
                    width: 1.2,
                    material: new Cesium.PolylineDashMaterialProperty({
                        color: Cesium.Color.fromCssColorString('rgba(0,220,255,0.5)'),
                        dashLength: 14,
                        dashPattern: 0xFF00,
                    }),
                    clampToGround: true,
                },
            } as any);
        }
    }

    // ── Shift 각도 고정 가이드 라인 ─────────────────────────────
    if (shiftActive && startWgs84 && !snapNode && !snapLink) {
        const startOl = fromLonLat([startWgs84.lng, startWgs84.lat]);
        const endOl   = fromLonLat([endWgs84.lng, endWgs84.lat]);
        const dx = endOl[0]! - startOl[0]!; const dy = endOl[1]! - startOl[1]!;
        const len = Math.hypot(dx, dy) || 1;
        const EXT = 3000;
        const ux = dx / len, uy = dy / len;
        const backOl  = [startOl[0]! - ux * EXT, startOl[1]! - uy * EXT];
        const frontOl = [startOl[0]! + ux * EXT, startOl[1]! + uy * EXT];
        const backLL  = toLonLat(backOl); const frontLL = toLonLat(frontOl);
        ds.entities.add({
            polyline: {
                positions: [
                    Cesium.Cartesian3.fromDegrees(backLL[0]!, backLL[1]!),
                    Cesium.Cartesian3.fromDegrees(frontLL[0]!, frontLL[1]!),
                ],
                width: 1.5,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString('rgba(255,220,0,0.75)'),
                    dashLength: 18,
                    dashPattern: 0xFF80,
                }),
                clampToGround: true,
            },
        } as any);
    }

    // 스냅 인디케이터
    if (snapNode) {
        // 외곽 글로우
        ds.entities.add({
            id: 'snapOuter',
            position: endPos,
            ellipse: {
                semiMajorAxis: 18, semiMinorAxis: 18,
                material: NEON_GREEN.withAlpha(0.06),
                outline: true,
                outlineColor: NEON_GREEN.withAlpha(0.35),
                outlineWidth: 1,
                height: 0.1,
            },
        } as any);
        ds.entities.add({
            id: 'snap',
            position: endPos,
            ellipse: {
                semiMajorAxis: 10, semiMinorAxis: 10,
                material: NEON_GREEN.withAlpha(0.18),
                outline: true,
                outlineColor: NEON_GREEN,
                outlineWidth: 2.5,
                height: 0.1,
            },
        } as any);
    } else if (snapLink) {
        ds.entities.add({
            id: 'linkSnapOuter',
            position: endPos,
            ellipse: {
                semiMajorAxis: 18, semiMinorAxis: 18,
                material: NEON_ORANGE.withAlpha(0.06),
                outline: true,
                outlineColor: NEON_ORANGE.withAlpha(0.3),
                outlineWidth: 1,
                height: 0.1,
            },
        } as any);
        ds.entities.add({
            id: 'linkSnap',
            position: endPos,
            ellipse: {
                semiMajorAxis: 10, semiMinorAxis: 10,
                material: NEON_ORANGE.withAlpha(0.15),
                outline: true,
                outlineColor: NEON_ORANGE,
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
                color: Cesium.Color.WHITE.withAlpha(0.9),
                outlineColor: NEON_CYAN,
                outlineWidth: 2.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        } as any);
    }

    // 도로 프리뷰
    if (startWgs84) {
        const startPos = Cesium.Cartesian3.fromDegrees(startWgs84.lng, startWgs84.lat);

        // 외곽 글로우 코리도
        ds.entities.add({
            id: 'roadGlow',
            corridor: {
                positions: [startPos, endPos],
                width: linkWidth + 12,
                material: NEON_CYAN.withAlpha(0.08),
                height: 0.02,
                cornerType: Cesium.CornerType.MITERED,
            },
        } as any);

        // 중간 글로우
        ds.entities.add({
            id: 'roadMid',
            corridor: {
                positions: [startPos, endPos],
                width: linkWidth + 4,
                material: NEON_CYAN.withAlpha(0.16),
                height: 0.03,
                cornerType: Cesium.CornerType.MITERED,
            },
        } as any);

        // 메인 도로 코리도
        ds.entities.add({
            id: 'road',
            corridor: {
                positions: [startPos, endPos],
                width: linkWidth,
                material: NEON_CYAN.withAlpha(0.30),
                height: 0.05,
                cornerType: Cesium.CornerType.MITERED,
            },
        } as any);

        // 중심선 (Polyline Glow)
        ds.entities.add({
            id: 'centerLine',
            polyline: {
                positions: [startPos, endPos],
                width: 2.5,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.3,
                    color: Cesium.Color.WHITE.withAlpha(0.9),
                }),
                clampToGround: true,
            },
        } as any);

        // 시작점 마커 (글로우 효과)
        ds.entities.add({
            id: 'startNodeGlow',
            position: startPos,
            point: {
                pixelSize: 18,
                color: NEON_CYAN.withAlpha(0.2),
                outlineColor: NEON_CYAN.withAlpha(0.4),
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        } as any);
        ds.entities.add({
            id: 'startNode',
            position: startPos,
            point: {
                pixelSize: 10,
                color: NEON_CYAN,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        } as any);

        // 거리 + 방위각 라벨
        const dist = getDistance([startWgs84.lng, startWgs84.lat], [endWgs84.lng, endWgs84.lat]);
        if (dist > 1) {
            const dLon = (endWgs84.lng - startWgs84.lng) * Math.PI / 180;
            const lat1r = startWgs84.lat * Math.PI / 180;
            const lat2r = endWgs84.lat  * Math.PI / 180;
            const bearing = Math.round(
                ((Math.atan2(
                    Math.sin(dLon) * Math.cos(lat2r),
                    Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon),
                ) * 180 / Math.PI) + 360) % 360
            );
            const midLng = (startWgs84.lng + endWgs84.lng) / 2;
            const midLat = (startWgs84.lat + endWgs84.lat) / 2;
            const labelColor = shiftActive ? Cesium.Color.fromCssColorString('#ffdc00') : NEON_CYAN;
            ds.entities.add({
                id: 'distLabel',
                position: Cesium.Cartesian3.fromDegrees(midLng, midLat),
                label: {
                    text: `${Math.round(dist)}m · ${bearing}°${shiftActive ? ' 🔒' : ''}`,
                    font: 'bold 13px monospace',
                    fillColor: labelColor,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.55)'),
                    backgroundPadding: new Cesium.Cartesian2(6, 3),
                },
            } as any);
        }
    }
}

// ── 전체 네트워크 교차로 자동 생성 (export, 훅 외부에서 호출 가능) ──
// ── 두 선분의 교차점 계산 (OL 투영 좌표계) ─────────────────────────
// t, u ∈ (MARGIN, 1-MARGIN) 범위일 때만 유효 (끝점 근처는 제외)
function segmentIntersectOl(
    a1: Coordinate, a2: Coordinate,
    b1: Coordinate, b2: Coordinate,
    margin = 0.05,
): Coordinate | null {
    const d1x = a2[0]! - a1[0]!, d1y = a2[1]! - a1[1]!;
    const d2x = b2[0]! - b1[0]!, d2y = b2[1]! - b1[1]!;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return null; // 평행
    const dx = b1[0]! - a1[0]!, dy = b1[1]! - a1[1]!;
    const t = (dx * d2y - dy * d2x) / cross;
    const u = (dx * d1y - dy * d1x) / cross;
    if (t < margin || t > 1 - margin || u < margin || u > 1 - margin) return null;
    return [a1[0]! + t * d1x, a1[1]! + t * d1y];
}

// ── 기하학적 교차 감지 → Link 분할 → 교차로 자동 생성 ─────────────
// 반환값: 새로 생성된 교차로 노드 수
export function detectAndSplitIntersections(): number {
    let network = useNetworkStore.getState().currentJsonData;
    if (!network) return 0;

    let created = 0;
    let ts = Date.now() + 5000; // finishSegment ts와 충돌 방지

    // 교차 감지는 반복적으로: 한 번 분할 후 링크 목록이 바뀌므로 재시도
    let changed = true;
    while (changed) {
        changed = false;
        const links = network.links;

        outer:
        for (let i = 0; i < links.length; i++) {
            const linkA = links[i]!;
            const aCoords = linkA.coordinates;

            for (let j = i + 1; j < links.length; j++) {
                const linkB = links[j]!;

                // 같은 fromNode / toNode 를 공유하면 이미 연결됨 → 스킵
                if (String(linkA.fromNode) === String(linkB.fromNode) ||
                    String(linkA.fromNode) === String(linkB.toNode) ||
                    String(linkA.toNode)   === String(linkB.fromNode) ||
                    String(linkA.toNode)   === String(linkB.toNode)) continue;

                const bCoords = linkB.coordinates;

                for (let si = 0; si < aCoords.length - 1; si++) {
                    const a1 = fromLonLat([aCoords[si]!.lng, aCoords[si]!.lat]);
                    const a2 = fromLonLat([aCoords[si + 1]!.lng, aCoords[si + 1]!.lat]);

                    for (let sj = 0; sj < bCoords.length - 1; sj++) {
                        const b1 = fromLonLat([bCoords[sj]!.lng, bCoords[sj]!.lat]);
                        const b2 = fromLonLat([bCoords[sj + 1]!.lng, bCoords[sj + 1]!.lat]);

                        const pt = segmentIntersectOl(a1, a2, b1, b2);
                        if (!pt) continue;

                        const ll = toLonLat(pt);
                        const wgs84: Coordinates = { lng: ll[0]!, lat: ll[1]! };

                        // 기존 노드에 너무 가까우면 스킵 (이미 교차로가 있음)
                        const tooClose = network.nodes.some(n =>
                            getDistance(
                                [n.coordinates.lng, n.coordinates.lat],
                                [wgs84.lng, wgs84.lat],
                            ) < SNAP_RADIUS_M
                        );
                        if (tooClose) continue;

                        // ① linkA 분할 → 새 노드 nodeA_id 생성
                        ts += 20;
                        const { updatedNetwork: n1, newNodeId: nodeA_id } =
                            splitLinkInNetwork(network, linkA, wgs84, ts);
                        network = n1;

                        // ② linkB 분할 → 새 노드 nodeB_id 생성
                        ts += 20;
                        const linkBCurrent = network.links.find(l =>
                            String(l.id) === String(linkB.id)
                        );
                        let nodeB_id: number | string | null = null;
                        if (linkBCurrent) {
                            const { updatedNetwork: n2, newNodeId } =
                                splitLinkInNetwork(network, linkBCurrent, wgs84, ts);
                            network = n2;
                            nodeB_id = newNodeId;
                        }

                        // ③ 두 분할 노드를 하나로 병합 (nodeA_id 유지)
                        if (nodeB_id !== null) {
                            network = mergeNodes(network, nodeA_id, nodeB_id);
                        }

                        // ④ 병합된 교차로 노드에서 connection 재생성
                        network = regenerateNodeConnections(network, nodeA_id);

                        assignPropertyToResponseData(network as any);
                        created++;
                        changed = true;
                        break outer; // 링크 배열이 바뀌었으므로 재시작
                    }
                }
            }
        }
    }

    if (created > 0) {
        // 이미 연결된 교차로의 connection도 정리
        const intersectionNodes = network.nodes.filter(node => {
            const inCount  = node.ports?.filter((p: any) => p.type === 'in').length ?? 0;
            const outCount = node.ports?.filter((p: any) => p.type === 'out').length ?? 0;
            return inCount >= 1 && outCount >= 1;
        });
        for (const node of intersectionNodes) {
            network = regenerateNodeConnections(network, node.id);
        }
        assignPropertyToResponseData(network as any);
        useNetworkStore.getState().setCurrentJsonData(network);
        useNetworkStore.getState().setChange(true);
    }

    return created;
}

// ── 기존 노드 기반 connection 일괄 재생성 (링크는 이미 끊어진 경우) ──
export function autoGenerateAllIntersections(): number {
    const network = useNetworkStore.getState().currentJsonData;
    if (!network) return 0;

    const intersectionNodes = network.nodes.filter(node => {
        const inCount  = node.ports?.filter((p: any) => p.type === 'in').length ?? 0;
        const outCount = node.ports?.filter((p: any) => p.type === 'out').length ?? 0;
        return inCount >= 1 && outCount >= 1;
    });

    let result = network as Network;
    for (const node of intersectionNodes) {
        result = regenerateNodeConnections(result, node.id);
    }

    assignPropertyToResponseData(result as any);
    useNetworkStore.getState().setCurrentJsonData(result);
    useNetworkStore.getState().setChange(true);

    return intersectionNodes.length;
}

// ── 자동 교차로 플래시: Cesium (생성된 connection을 2초간 화살표로 표시) ──
const TURN_FLASH_COLOR: Record<string, Cesium.Color> = {
    Straight:   Cesium.Color.fromCssColorString('#00dcff'),
    Right_Turn: Cesium.Color.fromCssColorString('#ff50a0'),
    Left_Turn:  Cesium.Color.fromCssColorString('#ffc800'),
};
let _flashTimer: ReturnType<typeof setTimeout> | null = null;
let _flashDs: Cesium.CustomDataSource | null = null;

function flashIntersectionConnections(
    previewDs: Cesium.CustomDataSource,
    network: Network,
    nodeIds: (number | string)[],
) {
    // 기존 플래시 취소
    if (_flashTimer !== null) { clearTimeout(_flashTimer); _flashTimer = null; }
    if (_flashDs) {
        try { _flashDs.entities.removeAll(); } catch (_) {}
    }

    // previewDs를 잠시 점거 (도로 프리뷰는 완료됐으므로 안전)
    previewDs.entities.removeAll();
    _flashDs = previewDs;

    let idx = 0;
    for (const nodeId of nodeIds) {
        const node = network.nodes.find(n => String(n.id) === String(nodeId));
        if (!node) continue;
        const nodePos = Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat);

        // 노드 교차로 링 표시
        previewDs.entities.add({
            id: `_flash_ring_${idx}`,
            position: nodePos,
            ellipse: {
                semiMajorAxis: 6, semiMinorAxis: 6,
                material: Cesium.Color.fromCssColorString('#00dcff').withAlpha(0.15),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('#00dcff').withAlpha(0.8),
                outlineWidth: 2,
                height: 0.2,
            },
        } as any);

        for (const conn of node.connections) {
            const fromLink = network.links.find(l => String(l.id) === String(conn.fromLink));
            const toLink   = network.links.find(l => String(l.id) === String(conn.toLink));
            if (!fromLink || !toLink) continue;
            const fromWgs84 = getLaneEndpointWgs84(fromLink, conn.fromLane, 'target');
            const toWgs84   = getLaneEndpointWgs84(toLink, conn.toLane, 'source');
            const color = TURN_FLASH_COLOR[conn.turning] ?? Cesium.Color.GRAY;
            previewDs.entities.add({
                id: `_flash_conn_${idx}_${conn.id}`,
                polyline: {
                    positions: [
                        Cesium.Cartesian3.fromDegrees(fromWgs84.lng, fromWgs84.lat),
                        nodePos,
                        Cesium.Cartesian3.fromDegrees(toWgs84.lng, toWgs84.lat),
                    ],
                    width: 3.5,
                    material: new Cesium.PolylineArrowMaterialProperty(color.withAlpha(0.9)),
                    clampToGround: true,
                },
            } as any);
        }
        idx++;
    }

    _flashTimer = setTimeout(() => {
        try { previewDs.entities.removeAll(); } catch (_) {}
        _flashDs = null;
        _flashTimer = null;
    }, 2200);
}

// ── 자동 교차로 플래시: OL ──────────────────────────────────────────────
const TURN_FLASH_OL: Record<string, string> = {
    Straight:   'rgba(0,220,255,0.9)',
    Right_Turn: 'rgba(255,80,160,0.9)',
    Left_Turn:  'rgba(255,200,0,0.9)',
};
let _flashOlFeatures: Feature[] = [];
let _flashOlTimer: ReturnType<typeof setTimeout> | null = null;

function flashIntersectionConnectionsOl(
    src: VectorSource,
    network: Network,
    nodeIds: (number | string)[],
) {
    if (_flashOlTimer !== null) { clearTimeout(_flashOlTimer); _flashOlTimer = null; }
    _flashOlFeatures.forEach(f => { try { src.removeFeature(f); } catch (_) {} });
    _flashOlFeatures = [];

    for (const nodeId of nodeIds) {
        const node = network.nodes.find(n => String(n.id) === String(nodeId));
        if (!node) continue;
        const nodeOl = fromLonLat([node.coordinates.lng, node.coordinates.lat]);

        // 교차로 중심 링
        const ringF = new Feature(new Point(nodeOl));
        ringF.setStyle(new Style({
            image: new CircleStyle({
                radius: 14,
                fill: new Fill({ color: 'rgba(0,220,255,0.08)' }),
                stroke: new Stroke({ color: 'rgba(0,220,255,0.8)', width: 2, lineDash: [3, 2] }),
            }),
        }));
        src.addFeature(ringF);
        _flashOlFeatures.push(ringF);

        for (const conn of node.connections) {
            const fromLink = network.links.find(l => String(l.id) === String(conn.fromLink));
            const toLink   = network.links.find(l => String(l.id) === String(conn.toLink));
            if (!fromLink || !toLink) continue;
            const fromOl = getLaneEndpointOl(fromLink, conn.fromLane, 'target');
            const toOl   = getLaneEndpointOl(toLink, conn.toLane, 'source');
            const color  = TURN_FLASH_OL[conn.turning] ?? 'rgba(160,160,160,0.8)';
            const dx = toOl[0]! - fromOl[0]!; const dy = toOl[1]! - fromOl[1]!;
            const angle = Math.atan2(dy, dx);

            const lineF = new Feature(new LineString([fromOl, nodeOl, toOl]));
            lineF.setStyle(new Style({
                stroke: new Stroke({ color, width: 2, lineDash: [6, 4] }),
            }));
            src.addFeature(lineF);
            _flashOlFeatures.push(lineF);

            const arrowF = new Feature(new Point(toOl));
            arrowF.setStyle(new Style({
                image: new RegularShape({
                    points: 3, radius: 7,
                    fill: new Fill({ color }),
                    rotation: -(angle - Math.PI / 2),
                }),
            }));
            src.addFeature(arrowF);
            _flashOlFeatures.push(arrowF);
        }
    }

    _flashOlTimer = setTimeout(() => {
        _flashOlFeatures.forEach(f => { try { src.removeFeature(f); } catch (_) {} });
        _flashOlFeatures = [];
        _flashOlTimer = null;
    }, 2200);
}
