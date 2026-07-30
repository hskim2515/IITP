import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Feature } from 'ol';
import { LineString, Point, Polygon } from 'ol/geom';
import { Stroke, Fill, Style, Circle as CircleStyle, RegularShape } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import { Coordinate } from 'ol/coordinate';
import DragPan from 'ol/interaction/DragPan';
import DragZoom from 'ol/interaction/DragZoom';
import { pickNetworkAtPosition } from '@datasource/NetworkDataSourceLayer';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useMapStore } from '@stores/useMapStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkEditStore } from '@stores/useNetworkEditStore';
import { useNetworkUndoStore } from '@stores/useNetworkUndoStore';
import { useEditGuideStore } from '@stores/useEditGuideStore';
import { useNodeContextMenuStore } from '@stores/useNodeContextMenuStore';
import { useLinkContextMenuStore } from '@stores/useLinkContextMenuStore';
import { useMessageStore } from '@stores/useMessageStore';
import { useSignalStore, useSignalHistoryStore } from '@stores/useSignalStore';
import { useSignalTodStore, useSignalTodHistoryStore } from '@stores/useSignalTodStore';
import { useBusStationStore, useBusStationHistoryStore } from '@stores/useBusStationStore';
import { useRailStationStore, useRailStationHistoryStore } from '@stores/useRailStationStore';
import { usePavementMarkingStore, usePavementMarkingHistoryStore } from '@stores/usePavementMarkingStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { featureUpdateLogs } from '@utils/history';
import { generateDummySignalsForNode } from '@utils/signal';
import { getNetworkLodTierByResolution } from '@utils/lodConstants';
import { useModeStore } from '@stores/useModeStore';
import { usePropertyStore } from '@stores/usePropertyStore';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
import { Network, Link, Node, Lane, Segment, Coordinates } from '@type/Network';
import { containsCoordinate } from 'ol/extent';
import type { Extent } from 'ol/extent';
import type OLMap from 'ol/Map';

function setDragPan(map: OLMap, active: boolean) {
    map.getInteractions().getArray().forEach(i => {
        if (i instanceof DragPan) i.setActive(active);
    });
}

function setDragZoom(map: OLMap, active: boolean) {
    map.getInteractions().getArray().forEach(i => {
        if (i instanceof DragZoom) i.setActive(active);
    });
}

// ══════════════════════════════════════════════════════════════════
// 스타일
// ══════════════════════════════════════════════════════════════════
const linkSelectStyle = [
    new Style({ stroke: new Stroke({ color: 'rgba(255,200,0,0.2)', width: 20 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(255,200,0,0.9)', width: 3 }) }),
];
const linkHoverStyle = [
    new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,0.12)', width: 14 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,0.6)', width: 2 }) }),
];
const nodeSelectStyle = [
    new Style({ image: new CircleStyle({ radius: 14, fill: new Fill({ color: 'rgba(255,200,0,0.2)' }), stroke: new Stroke({ color: 'rgba(255,200,0,1)', width: 2.5 }) }) }),
    new Style({ image: new CircleStyle({ radius: 6, fill: new Fill({ color: 'rgba(255,200,0,1)' }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }) }),
];
// 레인 선택: 해당 레인 폴리곤을 노란 반투명으로 강조.
const laneSelectStyle = new Style({
    fill: new Fill({ color: 'rgba(255,200,0,0.35)' }),
    stroke: new Stroke({ color: 'rgba(255,200,0,0.95)', width: 2 }),
});
const nodeHoverStyle = [
    new Style({ image: new CircleStyle({ radius: 12, fill: new Fill({ color: 'rgba(255,255,255,0.08)' }), stroke: new Stroke({ color: 'rgba(255,255,255,0.6)', width: 2 }) }) }),
];
const editLineStyle = new Style({
    stroke: new Stroke({ color: 'rgba(80,160,255,0.85)', width: 2.5, lineDash: [7, 4] }),
});
const vertexStyle = new Style({
    image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#4080ff', width: 2 }) }),
});
const vertexHoverStyle = new Style({
    image: new CircleStyle({ radius: 9, fill: new Fill({ color: '#4080ff' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
});
const vertexDragStyle = new Style({
    image: new CircleStyle({ radius: 10, fill: new Fill({ color: '#ff9900' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
});
const snapIndicatorStyle = new Style({
    image: new CircleStyle({ radius: 13, fill: new Fill({ color: 'rgba(50,220,120,0.25)' }), stroke: new Stroke({ color: 'rgba(50,220,120,0.9)', width: 2 }) }),
});
const nodeHandleStyle = new Style({
    image: new CircleStyle({ radius: 10, fill: new Fill({ color: 'rgba(80,160,255,0.9)' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
});
const nodeHandleHoverStyle = new Style({
    image: new CircleStyle({ radius: 12, fill: new Fill({ color: '#4080ff' }), stroke: new Stroke({ color: '#fff', width: 2.5 }) }),
});
const nodeHandleDragStyle = new Style({
    image: new CircleStyle({ radius: 12, fill: new Fill({ color: '#ff9900' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
});

const SEL_Z   = 501;
const EDIT_Z  = 504;
const MULTI_Z = 502;
const BOX_Z   = 503;

const multiSelectLinkStyle = [
    new Style({ stroke: new Stroke({ color: 'rgba(100,200,255,0.15)', width: 16 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(100,200,255,0.85)', width: 2.5, lineDash: [8, 4] }) }),
];
const multiSelectNodeStyle = new Style({
    image: new CircleStyle({ radius: 12, fill: new Fill({ color: 'rgba(100,200,255,0.25)' }), stroke: new Stroke({ color: 'rgba(100,200,255,1)', width: 2 }) }),
});
const boxSelectStyle = new Style({
    fill: new Fill({ color: 'rgba(100,200,255,0.06)' }),
    stroke: new Stroke({ color: 'rgba(100,200,255,0.7)', width: 1.5, lineDash: [6, 4] }),
});

// ══════════════════════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════════════════════
function calcPathLength(coords: Coordinates[]): number {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++)
        total += getDistance([coords[i]!.lng, coords[i]!.lat], [coords[i+1]!.lng, coords[i+1]!.lat]);
    return total;
}

function olDist(a: Coordinate, b: Coordinate): number {
    return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

export function findNearestNode(nodes: Node[], coord: Coordinate, threshold: number): Node | null {
    let best: Node | null = null, minD = threshold;
    for (const n of nodes) {
        if (!n?.coordinates) continue; // null 요소 방어
        const d = olDist(fromLonLat([n.coordinates.lng, n.coordinates.lat]), coord);
        if (d < minD) { minD = d; best = n; }
    }
    return best;
}

export function findNearestLink(links: Link[], coord: Coordinate, threshold: number): Link | null {
    let best: Link | null = null, minD = threshold;
    for (const link of links) {
        if (!link?.coordinates) continue; // null 요소 방어
        const c = link.coordinates;
        for (let i = 0; i < c.length - 1; i++) {
            const a = fromLonLat([c[i]!.lng, c[i]!.lat]);
            const b = fromLonLat([c[i+1]!.lng, c[i+1]!.lat]);
            const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
            const len2 = dx*dx + dy*dy;
            if (len2 < 1e-10) continue;
            const t = Math.max(0, Math.min(1, ((coord[0]!-a[0]!)*dx + (coord[1]!-a[1]!)*dy) / len2));
            const d = olDist([a[0]!+t*dx, a[1]!+t*dy], coord);
            if (d < minD) { minD = d; best = link; }
        }
    }
    return best;
}

// 레인 최근접 탐색: 각 링크의 각 레인 중심선(링크 중심선 + 레인 오프셋)에 점-선분 최근접.
//   레인 오프셋은 렌더(NetworkFeatureLayer buildLinkFeatures)와 동일 공식:
//   offset = ((laneCount-1)/2 - i) * (link.width/laneCount), 세그먼트별 법선 적용(곡선 대응).
// frac: 링크 전체 길이 대비 종방향 위치(0~1) — 셀/세그먼트 인덱스 계산용.
export function findNearestLane(links: Link[], coord: Coordinate, threshold: number): { linkId: string; laneIdx: number; frac: number } | null {
    let best: { linkId: string; laneIdx: number; frac: number } | null = null;
    let minD = threshold;
    for (const link of links) {
        if (!link?.coordinates || link.coordinates.length < 2) continue; // null 요소 방어
        const lanes = link.lanes ?? [];
        const laneCount = lanes.length;
        if (laneCount === 0) continue;
        const laneW = (link.width ?? 7) / laneCount;
        const c = link.coordinates;
        // 링크 중심선을 3857 점 배열 + 세그먼트 누적거리(종방향 frac 계산용)
        const pts = c.map(p => fromLonLat([p.lng, p.lat]));
        const segLen: number[] = [], cum: number[] = [0];
        for (let si = 0; si < pts.length - 1; si++) {
            const l = Math.hypot(pts[si + 1]![0]! - pts[si]![0]!, pts[si + 1]![1]! - pts[si]![1]!);
            segLen.push(l); cum.push(cum[si]! + l);
        }
        const total = cum[cum.length - 1]! || 1;
        const roadW = link.width ?? 7;
        for (let li = 0; li < laneCount; li++) {
            // 2D MVT 렌더 정합: 도로는 중심선 기준 중앙정렬([-hw,+hw], dirOffset 없음),
            // 차선 0 = 최좌측(중앙선 쪽). 우측(+) 법선 기준이므로 좌측은 음수: (li - (n-1)/2)
            const off = (li - (laneCount - 1) / 2) * laneW;
            for (let si = 0; si < pts.length - 1; si++) {
                const a = pts[si]!, b = pts[si + 1]!;
                const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                const nx = dy / len, ny = -dx / len; // 우측 법선(3D right=dir×up 와 동일 방향)
                const oa = [a[0]! + nx * off, a[1]! + ny * off];
                const ob = [b[0]! + nx * off, b[1]! + ny * off];
                const odx = ob[0] - oa[0], ody = ob[1] - oa[1];
                const len2 = odx * odx + ody * ody;
                if (len2 < 1e-10) continue;
                const t = Math.max(0, Math.min(1, ((coord[0]! - oa[0]) * odx + (coord[1]! - oa[1]) * ody) / len2));
                const d = olDist([oa[0] + t * odx, oa[1] + t * ody], coord);
                if (d < minD) {
                    minD = d;
                    const frac = (cum[si]! + t * segLen[si]!) / total; // 종방향 0~1
                    best = { linkId: String(link.id), laneIdx: li, frac };
                }
            }
        }
    }
    return best;
}

// Cesium 스크린 좌표 탐색
function findNearestNodeCesium(nodes: Node[], pos: Cesium.Cartesian2, scene: Cesium.Scene, thresh: number): Node | null {
    let best: Node | null = null, minD = thresh;
    for (const n of nodes) {
        const sc = scene.cartesianToCanvasCoordinates(Cesium.Cartesian3.fromDegrees(n.coordinates.lng, n.coordinates.lat));
        if (!sc) continue;
        const d = Math.hypot(sc.x - pos.x, sc.y - pos.y);
        if (d < minD) { minD = d; best = n; }
    }
    return best;
}

function findNearestLinkCesium(links: Link[], pos: Cesium.Cartesian2, scene: Cesium.Scene, thresh: number): Link | null {
    let best: Link | null = null, minD = thresh;
    for (const link of links) {
        const c = link.coordinates;
        for (let i = 0; i < c.length - 1; i++) {
            const a2 = scene.cartesianToCanvasCoordinates(Cesium.Cartesian3.fromDegrees(c[i]!.lng, c[i]!.lat));
            const b2 = scene.cartesianToCanvasCoordinates(Cesium.Cartesian3.fromDegrees(c[i+1]!.lng, c[i+1]!.lat));
            if (!a2 || !b2) continue;
            const dx = b2.x-a2.x, dy = b2.y-a2.y;
            const len2 = dx*dx+dy*dy;
            if (len2 < 1) continue;
            const t = Math.max(0,Math.min(1,((pos.x-a2.x)*dx+(pos.y-a2.y)*dy)/len2));
            const d = Math.hypot(a2.x+t*dx-pos.x, a2.y+t*dy-pos.y);
            if (d < minD) { minD = d; best = link; }
        }
    }
    return best;
}

// ══════════════════════════════════════════════════════════════════
// 네트워크 변환 함수 (export)
// ══════════════════════════════════════════════════════════════════
export function deleteLinkFromNetwork(network: Network, linkId: number | string): Network {
    const link = network.links.find(l => String(l.id) === String(linkId));
    if (!link) return network;
    const updatedNodes = network.nodes.map(n => {
        if (String(n.id) !== String(link.fromNode) && String(n.id) !== String(link.toNode)) return n;
        const newPorts = n.ports.filter(p => String(p.linkId) !== String(linkId));
        const newConns = n.connections.filter(c => String(c.fromLink) !== String(linkId) && String(c.toLink) !== String(linkId));
        return { ...n, ports: newPorts, numPort: newPorts.length, connections: newConns, numConnection: newConns.length };
    });
    return { ...network, nodes: updatedNodes, links: network.links.filter(l => String(l.id) !== String(linkId)) };
}

export function deleteNodeFromNetwork(network: Network, nodeId: number | string): Network {
    const node = network.nodes.find(n => String(n.id) === String(nodeId));
    if (!node) return network;
    let result = network;
    for (const lid of node.ports.map(p => String(p.linkId)))
        result = deleteLinkFromNetwork(result, lid);
    return { ...result, nodes: result.nodes.filter(n => String(n.id) !== String(nodeId)) };
}

// ── 통과 노드 판별 + 링크 병합(레인 포함) ────────────────────────────
// 단순 통과점(in 링크 1개 + out 링크 1개, 차선 수 동일)을 삭제하면
// 두 링크를 잘라내는 대신 하나로 이어붙인다 — 도로가 끊기지 않도록.
// 차로 증/감 지점이거나 실제 교차로(in/out 2개 초과)면 false → 호출부는 기존 cascade 삭제로 폴백.
export function isPassThroughNode(network: Network, nodeId: number | string): boolean {
    const node = network.nodes.find(n => String(n.id) === String(nodeId));
    if (!node || node.ports.length !== 2) return false;
    const inPorts  = node.ports.filter(p => p.type === 'in');
    const outPorts = node.ports.filter(p => p.type === 'out');
    if (inPorts.length !== 1 || outPorts.length !== 1) return false;
    const linkIn  = network.links.find(l => String(l.id) === String(inPorts[0]!.linkId));
    const linkOut = network.links.find(l => String(l.id) === String(outPorts[0]!.linkId));
    if (!linkIn || !linkOut || String(linkIn.id) === String(linkOut.id)) return false;
    if (String(linkIn.fromNode) === String(linkOut.toNode)) return false; // 병합하면 셀프루프가 되는 경우 제외
    return linkIn.numLane === linkOut.numLane;
}

// 두 레인을 이어붙임 — segments는 뒤쪽 것을 오프셋만큼 밀어서 concat, cells는 양쪽 다 있을 때만 유지(그 외 빈 배열 규약 준수).
function concatLaneDerived(laneIn: any, laneOut: any, lenIn: number, lenOut: number, coords: Coordinates[]): any {
    const segsIn  = laneIn.segments?.length  > 0 ? laneIn.segments  : [{ featureType: 'segments', id: 0, block: false, initPoint: 0, endPoint: lenIn }];
    const segsOut = laneOut.segments?.length > 0 ? laneOut.segments : [{ featureType: 'segments', id: 0, block: false, initPoint: 0, endPoint: lenOut }];
    const segments = [
        ...segsIn,
        ...segsOut.map((s: any, i: number) => ({ ...s, id: segsIn.length + i, initPoint: s.initPoint + lenIn, endPoint: s.endPoint + lenIn })),
    ];
    const cells = (laneIn.cells?.length > 0 && laneOut.cells?.length > 0)
        ? [...laneIn.cells, ...laneOut.cells.map((c: any, i: number) => ({ ...c, id: laneIn.cells.length + i, offset: c.offset + lenIn }))]
        : [];
    const newLength = lenIn + lenOut;
    return {
        ...laneIn, coordinates: coords, segments, cells,
        numCell: cells.length > 0 ? cells.length : Math.max(1, Math.ceil(newLength / 100)),
    };
}

// 통과 노드가 아니면 null — 호출부는 null이면 deleteNodeFromNetwork(cascade 삭제)로 폴백.
export function mergeLinksAtNode(network: Network, nodeId: number | string): Network | null {
    if (!isPassThroughNode(network, nodeId)) return null;
    const node = network.nodes.find(n => String(n.id) === String(nodeId))!;
    const linkIn  = network.links.find(l => String(l.id) === String(node.ports.find(p => p.type === 'in')!.linkId))!;
    const linkOut = network.links.find(l => String(l.id) === String(node.ports.find(p => p.type === 'out')!.linkId))!;

    const mergedCoords = [...linkIn.coordinates, ...linkOut.coordinates.slice(1)];
    const lenIn  = linkIn.length  || calcPathLength(linkIn.coordinates);
    const lenOut = linkOut.length || calcPathLength(linkOut.coordinates);

    const mergedLanes = linkIn.lanes.map((laneIn, i) => {
        const laneOut = linkOut.lanes[i];
        if (!laneOut) return laneIn;
        const laneCoords = [...laneIn.coordinates, ...laneOut.coordinates.slice(1)];
        return concatLaneDerived(laneIn, laneOut, lenIn, lenOut, laneCoords);
    });

    // linkIn의 id를 그대로 유지 → toNode 쪽 끝점(endNode)만 linkOut→linkIn 참조 갱신하면 됨
    const mergedLink: Link = {
        ...linkIn,
        toNode: linkOut.toNode,
        coordinates: mergedCoords,
        length: calcPathLength(mergedCoords),
        lanes: mergedLanes,
    };

    const endNodeId = linkOut.toNode;
    const updatedNodes = network.nodes
        .filter(n => String(n.id) !== String(nodeId))
        .map(n => {
            if (String(n.id) !== String(endNodeId)) return n;
            return {
                ...n,
                ports: n.ports.map(p => String(p.linkId) === String(linkOut.id) ? { ...p, linkId: linkIn.id } : p),
                connections: n.connections.map((c: any) =>
                    String(c.fromLink) === String(linkOut.id) ? { ...c, fromLink: linkIn.id, coordinates: [] } : c
                ),
            };
        });

    const updatedLinks = network.links
        .filter(l => String(l.id) !== String(linkOut.id))
        .map(l => String(l.id) === String(linkIn.id) ? mergedLink : l);

    return { ...network, nodes: updatedNodes, links: updatedLinks };
}

// 노드별로 통과점이면 병합, 아니면 cascade 삭제 — 다중 선택 삭제의 기본 진입점.
export function batchDeleteOrMergeNodes(network: Network, nodeIds: (number | string)[]): Network {
    return nodeIds.reduce((net, id) => mergeLinksAtNode(net, id) ?? deleteNodeFromNetwork(net, id), network);
}

// ── 노드(교차로) 삭제 연쇄: 신호/신호TOD 정리 ──────────────────────
// network.nodes에서 노드는 지워도 signal/signalTod는 별도 스토어라 자동으로 안 지워짐 → 명시 처리.
export function countSignalsForNodes(nodeIds: (number | string)[]): number {
    const ids = new Set(nodeIds.map(String));
    const signals = (useSignalStore.getState().currentJsonData as { signals?: any[] } | undefined)?.signals ?? [];
    return signals.filter(s => ids.has(String(s.nodeId))).length;
}

// 실제로 사라지는 링크 수 — 통과 노드는 병합되어 링크가 안 사라지므로 제외하고 셈.
export function countLinksLostForNodes(network: Network, nodeIds: (number | string)[]): number {
    const cascadeIds = new Set(nodeIds.filter(id => !isPassThroughNode(network, id)).map(String));
    if (cascadeIds.size === 0) return 0;
    return new Set(
        network.nodes
            .filter(n => cascadeIds.has(String(n.id)))
            .flatMap(n => n.ports.map(p => String(p.linkId)))
    ).size;
}

// cascade 삭제(병합 아님) 대상 노드들의 "먼 쪽" 끝 노드 id — 그 노드도 연결 링크가 사라지며 커넥션이 바뀜.
export function farNodeIdsForCascadeDelete(network: Network, nodeIds: (number | string)[]): string[] {
    const cascadeIds = new Set(nodeIds.filter(id => !isPassThroughNode(network, id)).map(String));
    if (cascadeIds.size === 0) return [];
    const far = new Set<string>();
    for (const node of network.nodes) {
        if (!cascadeIds.has(String(node.id))) continue;
        for (const p of node.ports) {
            const link = network.links.find(l => String(l.id) === String(p.linkId));
            if (!link) continue;
            const otherEnd = String(link.fromNode) === String(node.id) ? link.toNode : link.fromNode;
            if (!cascadeIds.has(String(otherEnd))) far.add(String(otherEnd));
        }
    }
    return [...far];
}

export function deleteSignalsForNodes(nodeIds: (number | string)[]): void {
    if (nodeIds.length === 0) return;
    const ids = new Set(nodeIds.map(String));

    const signals = (useSignalStore.getState().currentJsonData as { signals?: any[] } | undefined)?.signals ?? [];
    const signalGuids = signals
        .filter(s => ids.has(String(s.nodeId)))
        .map(s => s.__guid)
        .filter((g): g is string => !!g);
    if (signalGuids.length > 0) {
        useSignalStore.getState().removeRecordsByGuid(signalGuids, useSignalHistoryStore as any);
    }

    const todNodes = (useSignalTodStore.getState().currentJsonData as { nodes?: any[] } | undefined)?.nodes ?? [];
    const todGuids = todNodes
        .filter(n => ids.has(String(n.id)))
        .map(n => n.__guid)
        .filter((g): g is string => !!g);
    if (todGuids.length > 0) {
        useSignalTodStore.getState().removeRecordsByGuid(todGuids, useSignalTodHistoryStore as any);
    }
}

/**
 * 노드 하나의 신호를 토폴로지(접근로/방위각) 기준으로 통째로 (재)생성한다 — 기존 신호가
 * 있으면 먼저 전부 지운다(부분 병합이 아니라 "이 교차로의 완전한 신호 세트로 교체"가 목표,
 * SignalGroupedEditor의 "자동 생성"과 동일 원칙 — 둘 다 이 함수를 공유). 판정 기준은
 * generateDummySignalsForNode(iitp-rest DummySignalGenerator와 동일 로직)를 그대로 쓰므로
 * 신호 후보 조건(접근로 2개 이상 등) 미충족 노드는 null을 반환하고 아무 것도 하지 않는다.
 */
export function generateSignalsForNode(network: Network, nodeId: number | string): number | null {
    const generated = generateDummySignalsForNode(network, String(nodeId));
    if (generated.length === 0) return null;
    deleteSignalsForNodes([nodeId]);
    const base = (useSignalStore.getState().currentJsonData as { signals?: any[] } | undefined)?.signals?.length ?? 0;
    generated.forEach((partial, i) => {
        const newSig = {
            featureType: 'signals',
            ...partial,
            __guid: `signals-${base + i}`,
        };
        useSignalStore.getState().updateCurrentJsonData(newSig, useSignalHistoryStore as any);
        featureUpdateLogs(useSignalHistoryStore as any, { guid: newSig.__guid, updateType: 'added', properties: newSig });
    });
    return generated.length;
}

// ── 링크 삭제 연쇄: 정류장 정리 ──────────────────────────────────
// busStation/railStation은 linkRef로 특정 링크 위 위치를 참조하는 별개 스토어라 링크가
// 사라져도(직접 삭제든 노드 삭제로 인한 연쇄든) 자동으로는 안 지워진다. 신호(connectionId만
// null로 초기화)와 달리 정류장은 위치 자체가 그 링크에 종속돼 "참조만 비우기"가 불가능하므로
// (남기면 위치를 잃은 고아 레코드) 삭제 대상으로 본다.
function stationCountForLinkIdSet(ids: Set<string>): number {
    if (ids.size === 0) return 0;
    const busStations = (useBusStationStore.getState().currentJsonData as { busStations?: any[] } | undefined)?.busStations ?? [];
    const railStations = (useRailStationStore.getState().currentJsonData as { railStations?: any[] } | undefined)?.railStations ?? [];
    return busStations.filter(s => s.linkRef != null && ids.has(String(s.linkRef))).length
         + railStations.filter(s => s.linkRef != null && ids.has(String(s.linkRef))).length;
}

/** 지금 당장 이 링크들이 삭제되면 사라질 정류장 수 — 삭제 실행 "전" 확인 다이얼로그용. */
export function countStationsForLinks(linkIds: (number | string)[]): number {
    return stationCountForLinkIdSet(new Set(linkIds.map(String)));
}

/** 노드 삭제로 (통과 노드 병합을 제외하고) 함께 사라질 링크에 걸린 정류장 수 — 확인
 *  다이얼로그용. countLinksLostForNodes와 동일한 "cascade 대상 링크" 계산을 공유한다. */
export function countStationsForNodes(network: Network, nodeIds: (number | string)[]): number {
    const cascadeIds = new Set(nodeIds.filter(id => !isPassThroughNode(network, id)).map(String));
    if (cascadeIds.size === 0) return 0;
    const linkIds = new Set(
        network.nodes
            .filter(n => cascadeIds.has(String(n.id)))
            .flatMap(n => n.ports.map((p: any) => String(p.linkId)))
    );
    return stationCountForLinkIdSet(linkIds);
}

/** 실제로 사라진 링크 id 목록(삭제 적용 "후" markDeleted가 계산한 diff)을 받아 그 위의
 *  정류장을 실제로 지운다. 반환값은 지워진 정류장 수(안내 메시지용). */
export function deleteStationsForLinks(linkIds: (number | string)[]): number {
    const ids = new Set(linkIds.map(String));
    if (ids.size === 0) return 0;
    let count = 0;

    const busStations = (useBusStationStore.getState().currentJsonData as { busStations?: any[] } | undefined)?.busStations ?? [];
    const busGuids = busStations
        .filter(s => s.linkRef != null && ids.has(String(s.linkRef)))
        .map(s => s.__guid)
        .filter((g): g is string => !!g);
    if (busGuids.length > 0) {
        useBusStationStore.getState().removeRecordsByGuid(busGuids, useBusStationHistoryStore as any);
        count += busGuids.length;
    }

    const railStations = (useRailStationStore.getState().currentJsonData as { railStations?: any[] } | undefined)?.railStations ?? [];
    const railGuids = railStations
        .filter(s => s.linkRef != null && ids.has(String(s.linkRef)))
        .map(s => s.__guid)
        .filter((g): g is string => !!g);
    if (railGuids.length > 0) {
        useRailStationStore.getState().removeRecordsByGuid(railGuids, useRailStationHistoryStore as any);
        count += railGuids.length;
    }
    return count;
}

// 노면표시(pavementMarking)도 linkRef로 특정 링크의 특정 레인/셀을 참조하는 별개
// 스토어라 정류장과 동일한 문제 — 링크가 사라져도 자동으로는 안 지워진다. 위치가
// 그 링크의 레인/셀 형상에 종속돼 "참조만 비우기"가 불가능하므로(남기면 좌표를 잃은
// 고아 레코드) 정류장과 동일하게 삭제 대상으로 본다.
export function deletePavementMarkingsForLinks(linkIds: (number | string)[]): number {
    const ids = new Set(linkIds.map(String));
    if (ids.size === 0) return 0;

    const markings = (usePavementMarkingStore.getState().currentJsonData as { pavementMarkings?: any[] } | undefined)?.pavementMarkings ?? [];
    const guids = markings
        .filter(m => m.linkRef != null && ids.has(String(m.linkRef)))
        .map(m => m.__guid)
        .filter((g): g is string => !!g);
    if (guids.length > 0) {
        usePavementMarkingStore.getState().removeRecordsByGuid(guids, usePavementMarkingHistoryStore as any);
    }
    return guids.length;
}

// Link는 안 지우고 numLane만 줄이는 경우(updateLinkInNetwork/batchUpdateLinksInNetwork,
// 그리드 Lane 행 직접 삭제) — 링크 자체는 살아있어 deletePavementMarkingsForLinks 대상이
// 아니지만, 사라진 레인(laneRef) 위 노면표시는 커넥션과 동일하게 고아가 된다. remainingLaneIds는
// numLane 감소 "후" 남은 레인의 id(≈index) 집합.
export function deletePavementMarkingsForShrunkLanes(linkId: number | string, remainingLaneIds: Set<number | string>): number {
    const remaining = new Set([...remainingLaneIds].map(String));
    const markings = (usePavementMarkingStore.getState().currentJsonData as { pavementMarkings?: any[] } | undefined)?.pavementMarkings ?? [];
    const guids = markings
        .filter(m => m.linkRef != null && String(m.linkRef) === String(linkId) && m.laneRef != null && !remaining.has(String(m.laneRef)))
        .map(m => m.__guid)
        .filter((g): g is string => !!g);
    if (guids.length > 0) {
        usePavementMarkingStore.getState().removeRecordsByGuid(guids, usePavementMarkingHistoryStore as any);
    }
    return guids.length;
}

// 커넥션 삭제/재생성(regenerateNodeConnections, deleteLinkFromNetwork, numLane 감소 등) 뒤
// 더 이상 존재하지 않는 connectionId를 참조하는 신호를 찾아 정리한다.
// 신호 자체(nodeId/turning/plans)는 살아있는 movement라 유지하고, 무효해진 connectionId만
// null로 초기화 — 방치하면 NextSim 무결성 검사(validateSignalAgainstNetwork의 badConn)에서
// 편집 시점과 동떨어진 채 뒤늦게 걸려 원인 추적이 어려워진다. network는 반드시 이 연산 "이후"의
// 네트워크(node.connections가 최신 상태)를 넘겨야 한다.
export function reconcileSignalConnectionIds(network: Network, nodeIds: (number | string)[]): number {
    const ids = new Set(nodeIds.map(String));
    if (ids.size === 0) return 0;
    const connIdsByNode = new Map<string, Set<string>>();
    for (const node of network.nodes) {
        if (ids.has(String(node.id))) {
            connIdsByNode.set(String(node.id), new Set(node.connections.map((c: any) => String(c.id))));
        }
    }
    const signals = (useSignalStore.getState().currentJsonData as { signals?: any[] } | undefined)?.signals ?? [];
    let clearedCount = 0;
    for (const sig of signals) {
        if (sig.connectionId == null || !ids.has(String(sig.nodeId))) continue;
        const validConnIds = connIdsByNode.get(String(sig.nodeId));
        if (validConnIds && !validConnIds.has(String(sig.connectionId))) {
            useSignalStore.getState().updateCurrentJsonData(
                { __guid: sig.__guid, connectionId: null } as any,
                useSignalHistoryStore as any,
            );
            clearedCount++;
        }
    }
    return clearedCount;
}

/**
 * 링크 길이 변경 시 레인 파생물(cells/segments) 정합 갱신.
 *
 * <p>셀/세그먼트는 링크 길이의 종방향 분할이라 기하 편집 시 함께 갱신돼야 한다.
 * - segments: 비율 스케일 — 다중 세그먼트(block 구간 등)의 개수·속성 보존
 * - cells: 채워져 있으면 비율 스케일(개수·속성 보존, KTDB 임포트 링크),
 *          비어 있으면 빈 배열 유지(그린 도로 — 서버 생성 규약)
 * - numCell: cells 와 동기 (없으면 100m 균등 분할 규약)
 */
function rescaleLaneDerived(lane: any, oldLen: number, newLen: number, coords: Coordinates[]): any {
    const f = oldLen > 0 && newLen > 0 ? newLen / oldLen : null;
    const segs = (lane.segments?.length > 0 && f != null)
        ? lane.segments.map((s: any) => ({
            ...s,
            initPoint: Math.round(s.initPoint * f * 100) / 100,
            endPoint:  Math.round(s.endPoint  * f * 100) / 100,
        }))
        : [{ ...(lane.segments?.[0] ?? { featureType: 'segments', id: 0, block: false }), initPoint: 0, endPoint: newLen }];
    const cells = (lane.cells?.length > 0 && f != null)
        ? lane.cells.map((c: any) => ({
            ...c,
            offset: Math.round(c.offset * f * 100) / 100,
            length: Math.round(c.length * f * 100) / 100,
        }))
        : (lane.cells ?? []);
    return {
        ...lane, coordinates: coords, segments: segs, cells,
        numCell: cells.length > 0 ? cells.length : Math.max(1, Math.ceil(newLen / 100)),
    };
}

// 링크 끝점이 이동할 때, 레인 고유의 형상(오프셋 곡선 등)을 링크 중심선으로 뭉개지 않고
// 이동한 끝점만 델타 이동해 나머지 정점(중간 형상)은 그대로 보존한다.
function shiftEndpoint(coords: Coordinates[] | undefined, isFromEnd: boolean, dLat: number, dLng: number): Coordinates[] {
    if (!coords?.length) return coords ?? [];
    const next = coords.map(c => ({ ...c }));
    const idx = isFromEnd ? 0 : next.length - 1;
    next[idx] = { ...next[idx]!, lat: next[idx]!.lat + dLat, lng: next[idx]!.lng + dLng };
    return next;
}

function rebuildLanes(link: Link, numLane: number): Lane[] {
    const from = link.coordinates[0]!;
    const to   = link.coordinates[link.coordinates.length - 1]!;
    const length = getDistance([from.lng, from.lat], [to.lng, to.lat]);
    return Array.from({ length: numLane }, (_, i) => ({
        featureType: 'lanes' as any, id: i, linkRef: link.id as number,
        leftLaneId: i > 0 ? i-1 : -1, rightLaneId: i < numLane-1 ? i+1 : -1,
        numCell: Math.max(1, Math.ceil(length/100)),
        rightLC: true, leftLC: true, laneAccessType: null,
        shape: '', coordinates: [from, to],
        segments: [{ featureType: 'segments' as any, id: 0, block: false, initPoint: 0, endPoint: length }],
        cells: [], laneSource: null as any, laneTarget: null as any,
    }));
}

// ── 세그먼트(구간) 편집: block 토글 / 분할 / 병합 ────────────────────
// 세그먼트는 레인을 종방향으로 나눈 구간(초/종점 m 단위 + block 플래그) — 실측 KTDB 데이터에서
// 레인 드롭/합류 차로(우회전 전용차로 등, 링크 뒷부분만 block=True) 표현에 쓰인다.
// linkId/laneIdx/segIdx 는 항상 배열 인덱스 기준(lane.id 값이 아님) — 클릭 드릴다운
// (segmentIndexAtFrac) 및 다른 레인/셀 선택 코드(laneRef: lane.laneIdx)와 동일한 규약.

// 실측 KTDB 데이터는 레인 드롭이 있는 레인에만 <segment>를 두고 나머지 레인은 segments가
// 아예 빈 배열이다(예: 3차선 링크 중 최우측 레인만 segment 2개, 나머지는 0개). 빈 배열이면
// "전체 길이가 통행 가능한 세그먼트 1개"인 것과 의미상 동일하므로, 편집·표시 양쪽 모두
// 이 합성 세그먼트를 fallback으로 써야 한다 — 안 그러면 segIdx=0으로도 segments[0]이
// undefined라 "구간보기"가 아무것도 못 그리고, toggle/split도 조용히 no-op 된다.
export function getEffectiveSegments(lane: { segments?: Segment[] } | undefined, link: { length: number } | undefined): Segment[] {
    if (lane?.segments && lane.segments.length > 0) return lane.segments;
    return [{ id: 0, block: false, initPoint: 0, endPoint: link?.length ?? 0 }];
}

function updateLaneSegments(
    network: Network, linkId: number | string, laneIdx: number,
    updater: (segs: Segment[]) => Segment[],
): Network {
    return {
        ...network,
        links: network.links.map(l => {
            if (String(l.id) !== String(linkId)) return l;
            return {
                ...l,
                lanes: l.lanes.map((lane, i) => {
                    if (i !== laneIdx) return lane;
                    return { ...lane, segments: updater(getEffectiveSegments(lane, l)) };
                }),
            };
        }),
    };
}

export function toggleSegmentBlock(network: Network, linkId: number | string, laneIdx: number, segIdx: number): Network {
    return updateLaneSegments(network, linkId, laneIdx, (segs) =>
        segs.map((s, i) => i === segIdx ? { ...s, block: !s.block } : s)
    );
}

// 세그먼트를 중간 지점(또는 splitPoint 지정 시 그 지점)에서 둘로 나눈다. 분할 후 id는
// initPoint 순서대로 0..n-1 로 재부여(XML export 규약 — id가 배열 순서와 일치해야 함).
export function splitSegmentInNetwork(
    network: Network, linkId: number | string, laneIdx: number, segIdx: number, splitPoint?: number,
): Network {
    return updateLaneSegments(network, linkId, laneIdx, (segs) => {
        const seg = segs[segIdx];
        if (!seg) return segs;
        const mid = splitPoint ?? (seg.initPoint + seg.endPoint) / 2;
        if (!(mid > seg.initPoint && mid < seg.endPoint)) return segs; // 구간 밖 지점이면 분할 무시
        const result = [...segs];
        result.splice(segIdx, 1,
            { ...seg, endPoint: mid },
            { ...seg, initPoint: mid, endPoint: seg.endPoint },
        );
        return result.map((s, i) => ({ ...s, id: i }));
    });
}

// segIdx 세그먼트를 인접 구간과 하나로 합친다 — 다음 구간이 있으면 다음과, 없으면(마지막
// 구간) 이전 구간과. 병합 결과의 block 값은 두 구간 중 initPoint가 더 앞선(=먼저인) 쪽을 따른다.
export function mergeSegmentInNetwork(network: Network, linkId: number | string, laneIdx: number, segIdx: number): Network {
    return updateLaneSegments(network, linkId, laneIdx, (segs) => {
        if (segs.length <= 1) return segs;
        const withIdx = segIdx < segs.length - 1 ? segIdx + 1 : segIdx - 1;
        if (withIdx < 0 || withIdx >= segs.length) return segs;
        const lo = Math.min(segIdx, withIdx), hi = Math.max(segIdx, withIdx);
        const first = segs[lo]!, second = segs[hi]!;
        const merged: Segment = { ...first, initPoint: first.initPoint, endPoint: second.endPoint };
        const result = segs.filter((_, i) => i !== lo && i !== hi);
        result.splice(lo, 0, merged);
        return result.map((s, i) => ({ ...s, id: i }));
    });
}

export function updateLinkInNetwork(
    network: Network, linkId: number | string,
    patch: Partial<Pick<Link, 'numLane' | 'width' | 'maxSpd' | 'minSpd'>>,
): Network {
    const link = network.links.find(l => String(l.id) === String(linkId));
    if (!link) return network;

    const updatedLinks = network.links.map(l => {
        if (String(l.id) !== String(linkId)) return l;
        const updated = { ...l, ...patch };
        if (patch.numLane !== undefined && patch.numLane !== l.numLane)
            updated.lanes = rebuildLanes(updated, patch.numLane);
        return updated;
    });

    // width/numLane 변경 → 레인 오프셋 변화 → conn.coordinates stale.
    // numLane 감소 시 사라진 차선을 참조하는 커넥션은 삭제 (잔존 시 렌더/시뮬 인덱스 오류).
    const laneLayoutChanged = patch.width !== undefined || patch.numLane !== undefined;
    const newNumLane = patch.numLane;
    const updatedNodes = laneLayoutChanged
        ? network.nodes.map(n => {
            if (String(n.id) !== String(link.fromNode) && String(n.id) !== String(link.toNode)) return n;
            let conns = n.connections;
            if (newNumLane !== undefined && newNumLane < link.numLane) {
                conns = conns.filter((c: any) => {
                    if (String(c.fromLink) === String(linkId) && c.fromLane >= newNumLane) return false;
                    if (String(c.toLink) === String(linkId) && c.toLane >= newNumLane) return false;
                    return true;
                });
            }
            return {
                ...n,
                connections: conns.map((c: any) => ({ ...c, coordinates: [] })),
                numConnection: conns.length,
            };
        })
        : network.nodes;

    return { ...network, nodes: updatedNodes, links: updatedLinks };
}

export function updateLinkCoordinates(network: Network, linkId: number | string, newCoords: Coordinates[]): Network {
    const link = network.links.find(l => String(l.id) === String(linkId));
    if (!link) return network;

    const length   = calcPathLength(newCoords);
    const newFrom  = newCoords[0]!;
    const newTo    = newCoords[newCoords.length - 1]!;
    const oldFrom  = link.coordinates[0];
    const oldTo    = link.coordinates[link.coordinates.length - 1];
    const fromMoved = newFrom.lng !== oldFrom?.lng || newFrom.lat !== oldFrom?.lat;
    const toMoved   = newTo.lng   !== oldTo?.lng   || newTo.lat   !== oldTo?.lat;
    const endpointMoved = fromMoved || toMoved;
    // 정점 개수가 그대로면(끝점만 이동) 레인도 끝점만 델타 이동해 고유 형상 보존.
    // 정점이 추가/삭제됐으면(중간 형상 편집) 레인 대응점을 알 수 없어 링크 중심선으로 재계산.
    const onlyEndpointsChanged = newCoords.length === link.coordinates.length;
    const dFromLat = fromMoved ? newFrom.lat - (oldFrom?.lat ?? newFrom.lat) : 0;
    const dFromLng = fromMoved ? newFrom.lng - (oldFrom?.lng ?? newFrom.lng) : 0;
    const dToLat   = toMoved   ? newTo.lat   - (oldTo?.lat   ?? newTo.lat)   : 0;
    const dToLng   = toMoved   ? newTo.lng   - (oldTo?.lng   ?? newTo.lng)   : 0;

    const oldLen = link.length || calcPathLength(link.coordinates);
    const updatedLinks = network.links.map(l => {
        if (String(l.id) !== String(linkId)) return l;
        return {
            ...l, coordinates: newCoords, length,
            lanes: l.lanes.map((lane: any) => {
                let laneCoords = lane.coordinates;
                if (onlyEndpointsChanged) {
                    if (fromMoved) laneCoords = shiftEndpoint(laneCoords, true, dFromLat, dFromLng);
                    if (toMoved)   laneCoords = shiftEndpoint(laneCoords, false, dToLat, dToLng);
                } else {
                    laneCoords = newCoords;
                }
                return rescaleLaneDerived(lane, oldLen, length, laneCoords);
            }),
        };
    });

    // 끝점이 이동한 경우 연결된 노드의 conn.coordinates 평행이동
    const updatedNodes = endpointMoved
        ? network.nodes.map(n => {
            const isFromNode = String(n.id) === String(link.fromNode);
            const isToNode   = String(n.id) === String(link.toNode);
            if (!isFromNode && !isToNode) return n;
            const deltaFromLat = newFrom.lat - (oldFrom?.lat ?? newFrom.lat);
            const deltaFromLng = newFrom.lng - (oldFrom?.lng ?? newFrom.lng);
            const deltaToLat   = newTo.lat   - (oldTo?.lat   ?? newTo.lat);
            const deltaToLng   = newTo.lng   - (oldTo?.lng   ?? newTo.lng);
            return {
                ...n,
                connections: n.connections.map((c: any) => {
                    if (!c.coordinates?.length) return c;
                    // fromLink가 바뀐 링크이면 from 쪽 delta, toLink이면 to 쪽 delta 적용
                    const isFromLink = String(c.fromLink) === String(linkId);
                    const isToLink   = String(c.toLink)   === String(linkId);
                    if (!isFromLink && !isToLink) return c;
                    const dLat = isFromLink ? deltaToLat   : deltaFromLat;
                    const dLng = isFromLink ? deltaToLng   : deltaFromLng;
                    if (dLat === 0 && dLng === 0) return c;
                    return {
                        ...c,
                        coordinates: c.coordinates.map((pt: any) => ({
                            ...pt,
                            lat: pt.lat + dLat,
                            lng: pt.lng + dLng,
                        })),
                    };
                }),
            };
        })
        : network.nodes;

    return { ...network, nodes: updatedNodes, links: updatedLinks };
}

// ── 링크 방향 반전 (fromNode ↔ toNode, 좌표 역순, 포트 타입 flip) ──
export function reverseLinkDirection(network: Network, linkId: number | string): Network {
    const link = network.links.find(l => String(l.id) === String(linkId));
    if (!link) return network;

    const oldFrom = link.fromNode;
    const oldTo   = link.toNode;
    const reversedCoords = [...link.coordinates].reverse();

    const updatedLinks = network.links.map(l => {
        if (String(l.id) !== String(linkId)) return l;
        return {
            ...l,
            fromNode: oldTo,
            toNode: oldFrom,
            coordinates: reversedCoords,
            lanes: l.lanes.map(lane => ({
                ...lane,
                coordinates: [...lane.coordinates].reverse(),
            })),
        };
    });

    const updatedNodes = network.nodes.map(n => {
        const isFrom = String(n.id) === String(oldFrom);
        const isTo   = String(n.id) === String(oldTo);
        if (!isFrom && !isTo) return n;
        const newPorts = n.ports.map(p =>
            String(p.linkId) === String(linkId)
                ? { ...p, type: (p.type === 'in' ? 'out' : 'in') as 'in' | 'out' }
                : p
        );
        const newConns = n.connections.filter(c =>
            String(c.fromLink) !== String(linkId) && String(c.toLink) !== String(linkId)
        );
        return { ...n, ports: newPorts, numPort: newPorts.length, connections: newConns, numConnection: newConns.length };
    });

    return { ...network, links: updatedLinks, nodes: updatedNodes };
}

// ── 두 노드 병합 (keepNodeId 위치에 removeNodeId 흡수) ─────────────
export function mergeNodesInNetwork(
    network: Network,
    keepNodeId: number | string,
    removeNodeId: number | string,
): Network {
    const keepNode   = network.nodes.find(n => String(n.id) === String(keepNodeId));
    const removeNode = network.nodes.find(n => String(n.id) === String(removeNodeId));
    if (!keepNode || !removeNode) return network;

    const keepCoord = keepNode.coordinates;

    const updatedLinks = network.links.map(l => {
        let coords = [...l.coordinates];
        let fromNode = l.fromNode;
        let toNode   = l.toNode;
        let fromMoved = false, toMoved = false;
        if (String(l.fromNode) === String(removeNodeId)) { fromNode = keepNodeId as number; coords = [keepCoord, ...coords.slice(1)]; fromMoved = true; }
        if (String(l.toNode)   === String(removeNodeId)) { toNode   = keepNodeId as number; coords = [...coords.slice(0, -1), keepCoord]; toMoved = true; }
        if (fromNode === l.fromNode && toNode === l.toNode) return l;
        const newLen = calcPathLength(coords);
        const oldLen = l.length || calcPathLength(l.coordinates);
        const oldFrom = l.coordinates[0]!, oldTo = l.coordinates[l.coordinates.length - 1]!;
        const dFromLat = fromMoved ? keepCoord.lat - oldFrom.lat : 0;
        const dFromLng = fromMoved ? keepCoord.lng - oldFrom.lng : 0;
        const dToLat   = toMoved   ? keepCoord.lat - oldTo.lat   : 0;
        const dToLng   = toMoved   ? keepCoord.lng - oldTo.lng   : 0;
        return {
            ...l, fromNode, toNode, coordinates: coords, length: newLen,
            lanes: (l.lanes ?? []).map((lane: any) => {
                let laneCoords = lane.coordinates;
                if (fromMoved) laneCoords = shiftEndpoint(laneCoords, true, dFromLat, dFromLng);
                if (toMoved)   laneCoords = shiftEndpoint(laneCoords, false, dToLat, dToLng);
                return rescaleLaneDerived(lane, oldLen, newLen, laneCoords);
            }),
        };
    });

    const selfLoopIds = new Set(
        updatedLinks.filter(l => String(l.fromNode) === String(l.toNode)).map(l => String(l.id))
    );
    const filteredLinks = updatedLinks.filter(l => !selfLoopIds.has(String(l.id)));

    const mergedPorts = [...keepNode.ports, ...removeNode.ports]
        .filter(p => !selfLoopIds.has(String(p.linkId)));
    const mergedConns = [...keepNode.connections, ...removeNode.connections]
        .filter(c => !selfLoopIds.has(String(c.fromLink)) && !selfLoopIds.has(String(c.toLink)))
        .map((c: any) => ({ ...c, coordinates: [] }));

    const updatedNodes = network.nodes
        .filter(n => String(n.id) !== String(removeNodeId))
        .map(n => {
            if (String(n.id) !== String(keepNodeId)) {
                const np = n.ports.filter(p => !selfLoopIds.has(String(p.linkId)));
                const nc = n.connections.filter(c => !selfLoopIds.has(String(c.fromLink)) && !selfLoopIds.has(String(c.toLink)));
                return { ...n, ports: np, numPort: np.length, connections: nc, numConnection: nc.length };
            }
            return { ...n, ports: mergedPorts, numPort: mergedPorts.length, connections: mergedConns, numConnection: mergedConns.length };
        });

    return { ...network, nodes: updatedNodes, links: filteredLinks };
}

// ── 일괄 삭제 ──────────────────────────────────────────────────────
export function batchDeleteLinksFromNetwork(network: Network, linkIds: (number | string)[]): Network {
    return linkIds.reduce((net, id) => deleteLinkFromNetwork(net, id), network);
}

export function batchDeleteNodesFromNetwork(network: Network, nodeIds: (number | string)[]): Network {
    return nodeIds.reduce((net, id) => deleteNodeFromNetwork(net, id), network);
}

export function batchUpdateLinksInNetwork(
    network: Network,
    linkIds: (number | string)[],
    patch: Partial<Pick<Link, 'numLane' | 'width' | 'maxSpd'>>,
): Network {
    return linkIds.reduce((net, id) => updateLinkInNetwork(net, id, patch), network);
}

export function moveNode(network: Network, nodeId: number | string, newCoord: Coordinates): Network {
    const updatedNodes = network.nodes.map(n => {
        if (String(n.id) !== String(nodeId)) return n;
        const deltaLat = newCoord.lat - n.coordinates.lat;
        const deltaLng = newCoord.lng - n.coordinates.lng;
        return {
            ...n,
            coordinates: newCoord,
            connections: n.connections.map((c: any) => {
                if (!c.coordinates?.length) return c;
                return {
                    ...c,
                    coordinates: c.coordinates.map((pt: any) => ({
                        ...pt,
                        lat: pt.lat + deltaLat,
                        lng: pt.lng + deltaLng,
                    })),
                };
            }),
        };
    });
    const updatedLinks = network.links.map(l => {
        const isFrom = String(l.fromNode) === String(nodeId);
        const isTo   = String(l.toNode)   === String(nodeId);
        if (!isFrom && !isTo) return l;
        const coords = [...l.coordinates];
        if (isFrom) coords[0] = newCoord;
        if (isTo)   coords[coords.length - 1] = newCoord;
        const length = calcPathLength(coords);
        const oldLen = l.length || calcPathLength(l.coordinates);
        const oldFrom = l.coordinates[0]!, oldTo = l.coordinates[l.coordinates.length - 1]!;
        const dFromLat = isFrom ? newCoord.lat - oldFrom.lat : 0;
        const dFromLng = isFrom ? newCoord.lng - oldFrom.lng : 0;
        const dToLat   = isTo   ? newCoord.lat - oldTo.lat   : 0;
        const dToLng   = isTo   ? newCoord.lng - oldTo.lng   : 0;
        // 레인은 링크 중심선으로 덮어쓰지 않고 이동한 끝점만 델타 이동 — 레인 고유 형상 보존 + cells/segments 비율 갱신
        return {
            ...l, coordinates: coords, length,
            lanes: l.lanes.map((lane: any) => {
                let laneCoords = lane.coordinates;
                if (isFrom) laneCoords = shiftEndpoint(laneCoords, true, dFromLat, dFromLng);
                if (isTo)   laneCoords = shiftEndpoint(laneCoords, false, dToLat, dToLng);
                return rescaleLaneDerived(lane, oldLen, length, laneCoords);
            }),
        };
    });
    return { ...network, nodes: updatedNodes, links: updatedLinks };
}

// ══════════════════════════════════════════════════════════════════
// 편집 핸들 렌더링
// ══════════════════════════════════════════════════════════════════
type LinkEditFeatures = { lineFt: Feature; vertexFts: Feature[] };
type NodeEditFeatures = { handleFt: Feature };

function buildLinkEditFeatures(src: VectorSource, coords: Coordinates[]): LinkEditFeatures {
    src.clear();
    const lineCoords = coords.map(c => fromLonLat([c.lng, c.lat]));
    const lineFt = new Feature({ geometry: new LineString(lineCoords) });
    lineFt.setStyle(editLineStyle);
    src.addFeature(lineFt);

    const vertexFts = coords.map((c, i) => {
        const ft = new Feature({ geometry: new Point(fromLonLat([c.lng, c.lat])) });
        ft.setStyle(i === 0 || i === coords.length - 1 ? vertexHoverStyle : vertexStyle);
        src.addFeature(ft);
        return ft;
    });
    return { lineFt, vertexFts };
}

function buildNodeEditFeatures(src: VectorSource, node: Node): NodeEditFeatures {
    src.clear();
    const handleFt = new Feature({ geometry: new Point(fromLonLat([node.coordinates.lng, node.coordinates.lat])) });
    handleFt.setStyle(nodeHandleStyle);
    src.addFeature(handleFt);
    return { handleFt };
}

function updateLinkEditGeometry(lef: LinkEditFeatures, coords: Coordinates[], dragIdx: number | null, snapCoord: Coordinates | null) {
    // 선 업데이트
    (lef.lineFt.getGeometry() as LineString).setCoordinates(coords.map(c => fromLonLat([c.lng, c.lat])));
    // 꼭짓점 핸들 업데이트
    coords.forEach((c, i) => {
        const ft = lef.vertexFts[i];
        if (!ft) return;
        (ft.getGeometry() as Point).setCoordinates(fromLonLat([c.lng, c.lat]));
        if (i === dragIdx) ft.setStyle(snapCoord ? snapIndicatorStyle : vertexDragStyle);
        else ft.setStyle(i === 0 || i === coords.length-1 ? vertexHoverStyle : vertexStyle);
    });
}

/** 레인 폴리곤 링(3857) 생성 — findNearestLane 과 동일 오프셋 공식(렌더 정합). */
function buildLanePolygonRing(link: Link, laneIdx: number): number[][] | null {
    const lanes = link.lanes ?? [];
    const laneCount = lanes.length;
    if (laneCount === 0 || laneIdx < 0 || laneIdx >= laneCount) return null;
    const laneW = (link.width ?? 7) / laneCount;
    const off = ((laneCount - 1) / 2 - laneIdx) * laneW; // 레인 중심 오프셋
    const half = laneW / 2;
    const pts = link.coordinates.map(c => fromLonLat([c.lng, c.lat]));
    const left: number[][] = [], right: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)]!;
        const next = pts[Math.min(pts.length - 1, i + 1)]!;
        const sdx = next[0]! - prev[0]!, sdy = next[1]! - prev[1]!;
        const sl = Math.hypot(sdx, sdy) || 1;
        const nx = -sdy / sl, ny = sdx / sl;
        const cx = pts[i]![0]! + nx * off, cy = pts[i]![1]! + ny * off; // 레인 중심
        left.push([cx + nx * half, cy + ny * half]);
        right.push([cx - nx * half, cy - ny * half]);
    }
    return [...left, ...right.reverse(), left[0]!];
}

function renderHighlight(
    selSrc: VectorSource, hoverSrc: VectorSource, network: Network,
    selectedLinkId: number | string | null, selectedNodeId: number | string | null,
    hoveredLinkId: number | string | null, hoveredNodeId: number | string | null,
    selectedLaneId: string | null = null,
) {
    selSrc.clear(); hoverSrc.clear();
    if (selectedLaneId !== null) {
        const [lid, lidxStr] = selectedLaneId.split('_');
        const link = network.links.find(l => String(l.id) === String(lid));
        const ring = link ? buildLanePolygonRing(link, Number(lidxStr)) : null;
        if (ring) {
            const f = new Feature(new Polygon([ring]));
            f.setStyle(laneSelectStyle); selSrc.addFeature(f);
        }
    }
    if (selectedLinkId !== null) {
        const link = network.links.find(l => String(l.id) === String(selectedLinkId));
        if (link) {
            const f = new Feature(new LineString(link.coordinates.map(c => fromLonLat([c.lng, c.lat]))));
            f.setStyle(linkSelectStyle); selSrc.addFeature(f);
        }
    }
    if (selectedNodeId !== null) {
        const node = network.nodes.find(n => String(n.id) === String(selectedNodeId));
        if (node) {
            const f = new Feature(new Point(fromLonLat([node.coordinates.lng, node.coordinates.lat])));
            f.setStyle(nodeSelectStyle); selSrc.addFeature(f);
        }
    }
    if (hoveredLinkId !== null && hoveredLinkId !== selectedLinkId) {
        const link = network.links.find(l => String(l.id) === String(hoveredLinkId));
        if (link) {
            const f = new Feature(new LineString(link.coordinates.map(c => fromLonLat([c.lng, c.lat]))));
            f.setStyle(linkHoverStyle); hoverSrc.addFeature(f);
        }
    }
    if (hoveredNodeId !== null && hoveredNodeId !== selectedNodeId) {
        const node = network.nodes.find(n => String(n.id) === String(hoveredNodeId));
        if (node) {
            const f = new Feature(new Point(fromLonLat([node.coordinates.lng, node.coordinates.lat])));
            f.setStyle(nodeHoverStyle); hoverSrc.addFeature(f);
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 드래그 상태
// ══════════════════════════════════════════════════════════════════
type DragState = ({
    type: 'vertex';
    linkId: string | number;
    vertexIdx: number;
    workingCoords: Coordinates[];
    isEndpoint: boolean;
} | {
    type: 'node';
    nodeId: string | number;
    workingCoord: Coordinates;
}) & {
    /** pointermove가 실제 발생했는지 — 핸들 단순 클릭(무이동)이 no-op 커밋되는 것 방지 */
    moved?: boolean;
    /** 세그먼트 위 pointerdown으로 새로 삽입된 정점 드래그 (무이동 시 삽입 자체를 폐기) */
    inserted?: boolean;
};

/** 선택 링크의 세그먼트 위 최근접점 — 정점 추가(세그먼트 드래그)용 */
export function projectOnSegments(
    coords: Coordinates[], cursor: Coordinate, threshold: number,
): { segIdx: number; point: Coordinate } | null {
    let best: { segIdx: number; point: Coordinate; dist: number } | null = null;
    for (let i = 0; i < coords.length - 1; i++) {
        const a = fromLonLat([coords[i]!.lng, coords[i]!.lat]);
        const b = fromLonLat([coords[i + 1]!.lng, coords[i + 1]!.lat]);
        const abx = b[0]! - a[0]!, aby = b[1]! - a[1]!;
        const len2 = abx * abx + aby * aby;
        if (len2 < 1e-12) continue;
        let t = ((cursor[0]! - a[0]!) * abx + (cursor[1]! - a[1]!) * aby) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a[0]! + t * abx, py = a[1]! + t * aby;
        const d = Math.hypot(cursor[0]! - px, cursor[1]! - py);
        if (d < threshold && (!best || d < best.dist)) best = { segIdx: i, point: [px, py], dist: d };
    }
    return best ? { segIdx: best.segIdx, point: best.point } : null;
}

// ══════════════════════════════════════════════════════════════════
// 메인 훅
// ══════════════════════════════════════════════════════════════════
export const useNetworkSelect = () => {
    const olMap          = useOpenLayersStore(s => s.map);
    const viewer         = useCesiumStore(s => s.viewer);
    const isSelectActive  = useNetworkDrawStore(s => s.isSelectActive);
    const selectedLinkId  = useNetworkDrawStore(s => s.selectedLinkId);
    const selectedNodeId  = useNetworkDrawStore(s => s.selectedNodeId);
    const selectedLaneId  = useNetworkDrawStore(s => s.selectedLaneId);
    const selectedLinkIds = useNetworkDrawStore(s => s.selectedLinkIds);
    const selectedNodeIds = useNetworkDrawStore(s => s.selectedNodeIds);
    const connectTargetNodeId = useNetworkDrawStore(s => s.connectTargetNodeId);
    const appMode        = useModeStore(s => s.appMode); // 모드 전환 시 선택 초기화용

    // (구) 선택 편집 진입 시 mapViewMode='2D' 강제 로직 제거 — 편집모드는 split(2D 편집 + 3D 로드뷰)
    //   유지. 편집은 2D(OL) 전용이라 뷰 강제 불필요.

    // ── 상시 가이드: 선택 전/후 단계에 맞춰 안내 (토스트는 2초 후 사라져 조작법 안내 부적합) ──
    useEffect(() => {
        if (!isSelectActive) return;
        const hasSingle = selectedLinkId !== null || selectedNodeId !== null;
        const multiCount = selectedLinkIds.length + selectedNodeIds.length;
        if (connectTargetNodeId) {
            // "🔗 링크 연결" 진입 — 일반 선택 가이드보다 우선(연결 대상 지정 중에는 평소 선택
            // 안내가 아니라 이 전용 안내를 봐야 함).
            useEditGuideStore.getState().setGuide({
                title: `링크 연결 — 노드 ${connectTargetNodeId}`,
                steps: [
                    { keys: ['Shift+클릭', 'Ctrl/Cmd+클릭'], text: '연결할 링크(도로)를 하나 이상 선택하세요', em: true },
                    { keys: ['맥락 툴바'], text: '"✅ 연결 생성" — 선택한 링크마다 이 노드 위치에서 분할해 도로 형상 자체를 연결(도로 형상 안 바꾸고 커넥션만 필요하면 ESC 후 "⬡ 커넥션 생성" 사용)' },
                    { keys: ['ESC'], text: '링크 연결 취소' },
                ],
                tip: '여러 도로를 한 번에 선택하면 다중 접근로 교차로가 만들어집니다.',
            });
        } else if (selectedLinkId !== null) {
            useEditGuideStore.getState().setGuide({
                title: '선택·편집 — 링크 선택됨',
                steps: [
                    { keys: ['드래그'], text: '꼭짓점을 끌면 형상 변경 · 선 위를 끌면 그 자리에 정점 추가', em: true },
                    { keys: ['맥락 툴바'], text: '반전/분할/속성/삭제 · 레인 위 클릭 시 "차선보기"로 세부 단계 진입' },
                    { keys: ['Delete'], text: '링크 삭제' },
                    { keys: ['Ctrl+Z'], text: '실행 취소' },
                ],
                tip: '끝점을 다른 노드 근처로 끌면 자동으로 붙습니다.',
            });
        } else if (hasSingle) {
            useEditGuideStore.getState().setGuide({
                title: '선택·편집 — 노드 선택됨',
                steps: [
                    { keys: ['드래그'], text: '파란 핸들을 잡고 끌면 이동합니다 (연결 도로가 따라옵니다)', em: true },
                    { keys: ['맥락 툴바'], text: '교차로 생성/좌표편집/병합/삭제' },
                    { keys: ['Delete'], text: '노드 삭제 (연결 링크도 함께 — 확인 후 진행)' },
                    { keys: ['Ctrl+Z'], text: '실행 취소' },
                ],
                tip: '클릭 지점에 뜨는 툴바에서 좌표 직접 입력·가까운 노드와 병합도 할 수 있어요.',
            });
        } else if (multiCount > 0) {
            useEditGuideStore.getState().setGuide({
                title: `선택·편집 — ${multiCount}개 선택됨`,
                steps: [
                    { keys: ['Shift+클릭', 'Ctrl/Cmd+클릭'], text: '선택 추가/제외' },
                    { keys: ['Delete'], text: '선택한 요소 모두 삭제', em: true },
                    { keys: ['ESC'], text: '선택 해제' },
                ],
            });
        } else {
            useEditGuideStore.getState().setGuide({
                title: '선택·편집',
                steps: [
                    { keys: ['클릭'], text: '링크·노드·차선을 클릭해 선택하세요', em: true },
                    { keys: ['Shift+클릭', 'Ctrl/Cmd+클릭'], text: '여러 개 선택' },
                    { keys: ['Ctrl+드래그'], text: '빈 곳에서 끌면 박스로 범위 선택' },
                ],
                tip: '선택하면 이동·삭제·속성 편집을 할 수 있어요.',
            });
        }
        return () => { useEditGuideStore.getState().clear(); };
    }, [isSelectActive, selectedLinkId, selectedNodeId, selectedLinkIds, selectedNodeIds, connectTargetNodeId]);

    const selSrcRef   = useRef<VectorSource | null>(null);
    const hoverSrcRef = useRef<VectorSource | null>(null);
    const editSrcRef  = useRef<VectorSource | null>(null);
    const multiSrcRef = useRef<VectorSource | null>(null);
    const boxSrcRef   = useRef<VectorSource | null>(null);

    const hoveredLinkIdRef = useRef<number | string | null>(null);
    const hoveredNodeIdRef = useRef<number | string | null>(null);

    // 편집 피처 참조 (링크 or 노드)
    const linkEditRef = useRef<LinkEditFeatures | null>(null);
    const nodeEditRef = useRef<NodeEditFeatures | null>(null);
    /** 좌클릭 pointerdown 화면좌표 — 팬 드래그 후 click 을 선택으로 오처리하지 않기 위한 거리 판정 */
    const panStartPxRef = useRef<[number, number] | null>(null);
    /** 핸들/세그먼트/노드 드래그의 pointerdown 화면좌표 — 드래그 후 발화하는 click 억제용
     *  (정점 근접 반경으로 클릭을 통째로 무시하던 방식은 방금 드래그한 자리를 다시 클릭하는
     *  자연스러운 조작까지 막아 "레인 클릭 안 됨"을 만들었다 — 이동 거리 기반으로 정밀 억제) */
    const dragDownPxRef = useRef<[number, number] | null>(null);

    // 드래그 상태
    const dragStateRef = useRef<DragState | null>(null);

    // 박스 드래그 상태
    const boxStartRef  = useRef<Coordinate | null>(null);
    const boxFtRef     = useRef<Feature | null>(null);

    // ── 레이어 생명주기 ──────────────────────────────────────────
    useEffect(() => {
        if (!olMap || !isSelectActive) return; // 편집모드 선택(하이라이트+편집핸들)

        const selSrc   = new VectorSource();
        const hoverSrc = new VectorSource();
        const editSrc  = new VectorSource();
        const multiSrc = new VectorSource();
        const boxSrc   = new VectorSource();
        selSrcRef.current   = selSrc;
        hoverSrcRef.current = hoverSrc;
        editSrcRef.current  = editSrc;
        multiSrcRef.current = multiSrc;
        boxSrcRef.current   = boxSrc;

        const selLayer   = new VectorLayer({ source: selSrc,   zIndex: SEL_Z });
        const hoverLayer = new VectorLayer({ source: hoverSrc, zIndex: SEL_Z - 1 });
        const editLayer  = new VectorLayer({ source: editSrc,  zIndex: EDIT_Z });
        const multiLayer = new VectorLayer({ source: multiSrc, zIndex: MULTI_Z });
        const boxLayer   = new VectorLayer({ source: boxSrc,   zIndex: BOX_Z });
        olMap.addLayer(selLayer);
        olMap.addLayer(hoverLayer);
        olMap.addLayer(editLayer);
        olMap.addLayer(multiLayer);
        olMap.addLayer(boxLayer);
        olMap.getTargetElement().style.cursor = 'default';
        setDragZoom(olMap, false);  // Shift+드래그 OL 기본 줌 비활성

        return () => {
            useNetworkDrawStore.getState().clearSelection();
            useNetworkToolbarStore.getState().hide();
            dragStateRef.current   = null;
            linkEditRef.current    = null;
            nodeEditRef.current    = null;
            boxStartRef.current    = null;
            boxFtRef.current       = null;
            setDragPan(olMap, true);
            setDragZoom(olMap, true);  // DragZoom 복원
            olMap.removeLayer(selLayer);
            olMap.removeLayer(hoverLayer);
            olMap.removeLayer(editLayer);
            olMap.removeLayer(multiLayer);
            olMap.removeLayer(boxLayer);
            selSrcRef.current   = null;
            hoverSrcRef.current = null;
            editSrcRef.current  = null;
            multiSrcRef.current = null;
            boxSrcRef.current   = null;
            olMap.getTargetElement().style.cursor = '';
        };
    }, [olMap, isSelectActive]);

    // ── 선택 변경 → 하이라이트 + 편집 핸들 생성 ────────────────
    useEffect(() => {
        const rebuild = () => {
            const selSrc   = selSrcRef.current;
            const hoverSrc = hoverSrcRef.current;
            const editSrc  = editSrcRef.current;
            if (!selSrc || !hoverSrc || !editSrc) return;

            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;

            // 드래그 진행 중에는 스토어 변경(타일 동기화 등)이 끼어들어도 재구성하지 않는다
            // — 재구성이 dragStateRef 를 리셋해 진행 중 드래그가 끊기는 것 방지.
            if (dragStateRef.current) return;

            dragStateRef.current = null;
            linkEditRef.current  = null;
            nodeEditRef.current  = null;

            renderHighlight(selSrc, hoverSrc, network, selectedLinkId, selectedNodeId,
                hoveredLinkIdRef.current, hoveredNodeIdRef.current, selectedLaneId);

            // 편집 핸들은 편집 조작용 → 선택 모드에서만. 레인은 편집 핸들 없음(선택+속성만).
            if (isSelectActive && selectedLinkId !== null) {
                const link = network.links.find(l => String(l.id) === String(selectedLinkId));
                if (link) linkEditRef.current = buildLinkEditFeatures(editSrc, link.coordinates);
            } else if (isSelectActive && selectedNodeId !== null) {
                const node = network.nodes.find(n => String(n.id) === String(selectedNodeId));
                if (node) nodeEditRef.current = buildNodeEditFeatures(editSrc, node);
            } else {
                editSrc.clear();
            }
        };
        rebuild();
        // undo/redo·패널 수정 등 스토어 데이터 변경 시에도 하이라이트/편집 핸들 재구성 —
        // 선택 ID 만 의존하면 Ctrl+Z 후 옛 형상 핸들·점선이 화면에 잔존한다 (실사용 재현).
        const unsub = (useNetworkStore as any).subscribe(
            (s: any) => s.currentJsonData,
            () => rebuild(),
            { equalityFn: (a: any, b: any) => a === b },
        );
        return unsub;
    }, [selectedLinkId, selectedNodeId, selectedLaneId, isSelectActive]);

    // 모드 전환(보기↔편집) 시 선택 초기화 (확정 요구사항) — 맥락 툴바도 함께 닫음
    useEffect(() => {
        useNetworkDrawStore.getState().clearSelection();
        useNetworkToolbarStore.getState().hide();
    }, [appMode]);

    // ── OL 포인터 이벤트 (선택 + Ctrl+드래그 편집) ──────────────
    useEffect(() => {
        if (!olMap || !isSelectActive) return; // 편집모드 선택 전용(속성조회는 defaultEventHandler 담당)
        const vp = olMap.getViewport();

        // 우클릭: 선택 링크의 내부 정점 → 정점 삭제 / 링크 위 → 링크 메뉴(분할·반전·삭제) /
        //         노드 위 → 노드 메뉴(교차로 생성 등) / 그 외 → 브라우저 메뉴만 차단
        const onContextMenu = (e: Event) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!useNetworkDrawStore.getState().isSelectActive) return;
            const me = e as MouseEvent;
            const coord = olMap.getEventCoordinate(me);
            const res   = olMap.getView().getResolution() ?? 1;
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const { selectedLinkId: sl } = useNetworkDrawStore.getState();

            // 1) 선택 링크의 내부 정점 우클릭 → 정점 삭제 (끝점은 노드 연결이라 제외)
            if (sl !== null) {
                const link = network.links.find(l => String(l.id) === String(sl));
                if (link && link.coordinates.length > 2) {
                    let hitIdx = -1, minD = res * 18;
                    link.coordinates.forEach((c, i) => {
                        if (i === 0 || i === link.coordinates.length - 1) return;
                        const d = olDist(fromLonLat([c.lng, c.lat]), coord);
                        if (d < minD) { minD = d; hitIdx = i; }
                    });
                    if (hitIdx > 0) {
                        const newCoords = link.coordinates.filter((_, i) => i !== hitIdx);
                        const newNet = updateLinkCoordinates(network, sl, newCoords);
                        applyNetworkUpdate(newNet);
                        useMessageStore.getState().setMessage({ type: 'info', text: '정점을 삭제했습니다' });
                        if (editSrcRef.current) {
                            const updated = newNet.links.find(l => String(l.id) === String(sl));
                            if (updated) linkEditRef.current = buildLinkEditFeatures(editSrcRef.current, updated.coordinates);
                        }
                        // 선택 하이라이트(주황 점선)도 새 형상으로 갱신 — 미갱신 시 옛 형상 잔존 (실사용 재현)
                        if (selSrcRef.current && hoverSrcRef.current) {
                            renderHighlight(selSrcRef.current, hoverSrcRef.current, newNet, sl, null, null, null);
                        }
                        return;
                    }
                }
            }

            // 2) 노드 우클릭 → 노드 컨텍스트 메뉴 (교차로 생성/재생성)
            const hitNode = findNearestNode(network.nodes, coord, res * 20);
            if (hitNode) {
                useNodeContextMenuStore.getState().show(me.clientX, me.clientY, hitNode.id);
                return;
            }

            // 3) 링크 우클릭 → 링크 컨텍스트 메뉴 (여기서 분할·방향 반전·삭제)
            const hitLink = findNearestLink(network.links, coord, res * 15);
            if (hitLink) {
                const ll = toLonLat(coord);
                useLinkContextMenuStore.getState().show(
                    me.clientX, me.clientY, hitLink.id, { lng: ll[0]!, lat: ll[1]! });
            }
        };
        vp.addEventListener('contextmenu', onContextMenu, true);

        // ──────────────────── pointerdown ──────────────────────
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            panStartPxRef.current = [e.clientX, e.clientY]; // click 드래그 거리 판정용 (모드 무관)
            // 편집 조작(드래그 꼭짓점/노드 이동, 범위선택)은 선택 모드 전용 — 보기모드는 선택만.
            if (!useNetworkDrawStore.getState().isSelectActive) return;

            // 선택된 피처의 핸들 위에서는 Ctrl 없이 바로 드래그 이동 (일반 편집툴 UX).
            // 빈 곳 드래그 = 지도 팬 유지, Ctrl+빈 곳 드래그 = 박스 범위선택.
            const coord = olMap.getEventCoordinate(e);
            const res   = olMap.getView().getResolution() ?? 1;
            const HANDLE_THRESH = res * 22;
            const network = useNetworkStore.getState().currentJsonData;
            const { selectedLinkId: sl, selectedNodeId: sn } = useNetworkDrawStore.getState();

            // 링크 꼭짓점 핸들 히트 검사
            if (sl !== null && linkEditRef.current && network) {
                const link = network.links.find(l => String(l.id) === String(sl));
                if (link) {
                    let hitIdx = -1, minD = HANDLE_THRESH;
                    link.coordinates.forEach((c, i) => {
                        const d = olDist(fromLonLat([c.lng, c.lat]), coord);
                        if (d < minD) { minD = d; hitIdx = i; }
                    });
                    if (hitIdx >= 0) {
                        dragStateRef.current = {
                            type: 'vertex', linkId: sl, vertexIdx: hitIdx,
                            workingCoords: link.coordinates.map(c => ({ ...c })),
                            isEndpoint: hitIdx === 0 || hitIdx === link.coordinates.length - 1,
                        };
                        dragDownPxRef.current = [e.clientX, e.clientY];
                        setDragPan(olMap, false);
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        olMap.getTargetElement().style.cursor = 'grabbing';
                        return;
                    }

                    // 정점 아님 + 선(세그먼트) 위 → 새 정점 삽입 후 즉시 드래그 (표준 편집툴 UX).
                    // 무이동 드롭이면 pointerup에서 삽입 자체가 폐기된다(moved 플래그).
                    const proj = projectOnSegments(link.coordinates, coord, res * 12);
                    if (proj) {
                        const ll = toLonLat(proj.point);
                        const working = link.coordinates.map(c => ({ ...c }));
                        working.splice(proj.segIdx + 1, 0, { lng: ll[0]!, lat: ll[1]! });
                        dragStateRef.current = {
                            type: 'vertex', linkId: sl, vertexIdx: proj.segIdx + 1,
                            workingCoords: working,
                            isEndpoint: false,
                            inserted: true,
                        };
                        dragDownPxRef.current = [e.clientX, e.clientY];
                        // 편집 핸들을 삽입된 정점 포함으로 재구성 (드래그 중 시각 피드백)
                        if (editSrcRef.current) {
                            linkEditRef.current = buildLinkEditFeatures(editSrcRef.current, working);
                        }
                        setDragPan(olMap, false);
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        olMap.getTargetElement().style.cursor = 'grabbing';
                        return;
                    }
                }
            }

            // 노드 핸들 히트 검사
            if (sn !== null && nodeEditRef.current && network) {
                const node = network.nodes.find(n => String(n.id) === String(sn));
                if (node) {
                    const d = olDist(fromLonLat([node.coordinates.lng, node.coordinates.lat]), coord);
                    if (d < HANDLE_THRESH) {
                        dragStateRef.current = {
                            type: 'node', nodeId: sn,
                            workingCoord: { ...node.coordinates },
                        };
                        dragDownPxRef.current = [e.clientX, e.clientY];
                        setDragPan(olMap, false);
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        olMap.getTargetElement().style.cursor = 'grabbing';
                        return;
                    }
                }
            }

            // Ctrl + 빈 공간 → 박스 범위 선택 (Ctrl 없는 빈 곳 드래그는 지도 팬)
            if (e.ctrlKey && !e.shiftKey && network) {
                const hitNode = findNearestNode(network.nodes, coord, res * 20);
                const hitLink = !hitNode ? findNearestLink(network.links, coord, res * 15) : null;
                if (!hitNode && !hitLink) {
                    boxStartRef.current = coord;
                    const boxFt = new Feature(new Polygon([[coord, coord, coord, coord, coord]]));
                    boxFt.setStyle(boxSelectStyle);
                    boxSrcRef.current?.addFeature(boxFt);
                    boxFtRef.current = boxFt;
                    setDragPan(olMap, false);
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    olMap.getTargetElement().style.cursor = 'crosshair';
                }
            }
        };
        vp.addEventListener('pointerdown', onPointerDown, true);

        // ──────────────────── pointermove ──────────────────────
        const onPointerMove = (e: PointerEvent) => {
            const coord = olMap.getEventCoordinate(e);
            const res   = olMap.getView().getResolution() ?? 1;
            const drag  = dragStateRef.current;
            const network = useNetworkStore.getState().currentJsonData;

            // 박스 드래그 중
            if (boxStartRef.current && boxFtRef.current) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                const [x0, y0] = boxStartRef.current;
                const [x1, y1] = coord;
                (boxFtRef.current.getGeometry() as Polygon).setCoordinates([
                    [[x0!, y0!], [x1!, y0!], [x1!, y1!], [x0!, y1!], [x0!, y0!]],
                ]);
                return;
            }

            // 드래그 중
            if (drag) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                drag.moved = true;
                const ll = toLonLat(coord);
                const newGeo: Coordinates = { lng: ll[0]!, lat: ll[1]! };

                if (drag.type === 'vertex' && linkEditRef.current && network) {
                    // 끝점 스냅 (끝점 드래그 시 다른 노드에 스냅)
                    let snapped: Coordinates | null = null;
                    if (drag.isEndpoint) {
                        const SNAP_THRESH = res * 25;
                        const snapNode = findNearestNode(
                            network.nodes.filter(n => {
                                // 현재 링크의 fromNode/toNode 제외 (자기 자신 끝점)
                                const link = network.links.find(l => String(l.id) === String(drag.linkId));
                                if (!link) return true;
                                const ownNodeId = drag.vertexIdx === 0
                                    ? String(link.fromNode) : String(link.toNode);
                                return String(n.id) !== ownNodeId;
                            }),
                            coord, SNAP_THRESH,
                        );
                        if (snapNode) snapped = snapNode.coordinates;
                    }
                    drag.workingCoords[drag.vertexIdx] = snapped ?? newGeo;
                    updateLinkEditGeometry(linkEditRef.current, drag.workingCoords, drag.vertexIdx, snapped);

                } else if (drag.type === 'node' && nodeEditRef.current) {
                    drag.workingCoord = newGeo;
                    (nodeEditRef.current.handleFt.getGeometry() as Point)
                        .setCoordinates(fromLonLat([newGeo.lng, newGeo.lat]));
                    nodeEditRef.current.handleFt.setStyle(nodeHandleDragStyle);
                }
                return;
            }

            // 드래그 아닌 hover — 선택 피처의 핸들 근처면 grab 커서 (Ctrl 불필요)
            const { selectedLinkId: sl, selectedNodeId: sn } = useNetworkDrawStore.getState();

            let onHandle = false;
            if (sl !== null && linkEditRef.current && network) {
                const link = network.links.find(l => String(l.id) === String(sl));
                if (link) {
                    onHandle = link.coordinates.some(
                        c => olDist(fromLonLat([c.lng, c.lat]), coord) < res * 22
                    );
                }
            }
            if (!onHandle && sn !== null && nodeEditRef.current && network) {
                const node = network.nodes.find(n => String(n.id) === String(sn));
                if (node) {
                    onHandle = olDist(fromLonLat([node.coordinates.lng, node.coordinates.lat]), coord) < res * 22;
                }
            }
            if (onHandle) {
                olMap.getTargetElement().style.cursor = 'grab';
                return;
            }
            // 선택 링크의 세그먼트 위 → 정점 추가 가능 (copy 커서로 힌트)
            if (sl !== null && linkEditRef.current && network) {
                const link = network.links.find(l => String(l.id) === String(sl));
                if (link && projectOnSegments(link.coordinates, coord, res * 12)) {
                    olMap.getTargetElement().style.cursor = 'copy';
                    return;
                }
            }
            if (e.ctrlKey) {
                // Ctrl + 빈 곳: 박스 범위선택 안내
                olMap.getTargetElement().style.cursor = 'crosshair';
                return;
            }
            olMap.getTargetElement().style.cursor = 'default';

            // hover highlight (선택 없을 때)
            if (sl === null && sn === null) {
                const selSrc   = selSrcRef.current;
                const hoverSrc = hoverSrcRef.current;
                if (!network || !selSrc || !hoverSrc) return;
                const node2 = findNearestNode(network.nodes, coord, res * 20);
                const link2 = !node2 ? findNearestLink(network.links, coord, res * 15) : null;
                const newHovNode = node2 ? node2.id : null;
                const newHovLink = link2 ? link2.id : null;
                if (String(newHovNode) !== String(hoveredNodeIdRef.current) ||
                    String(newHovLink) !== String(hoveredLinkIdRef.current)) {
                    hoveredNodeIdRef.current = newHovNode;
                    hoveredLinkIdRef.current = newHovLink;
                    olMap.getTargetElement().style.cursor = (node2 || link2) ? 'pointer' : 'default';
                    renderHighlight(selSrc, hoverSrc, network, null, null, newHovLink, newHovNode);
                }
            }
        };
        document.addEventListener('pointermove', onPointerMove, true);

        // ──────────────────── pointerup ───────────────────────
        const onPointerUp = (e: PointerEvent) => {
            // 어떤 경로로든 빠져나올 때 항상 DragPan 복원 + 커서 초기화
            const hadBox  = !!(boxStartRef.current || boxFtRef.current);
            const hadDrag = !!dragStateRef.current;
            if (!hadBox && !hadDrag) return;

            setDragPan(olMap, true);
            olMap.getTargetElement().style.cursor = 'default';
            e.stopPropagation();

            // 박스 드래그 완료
            if (hadBox) {
                const boxFt  = boxFtRef.current;
                boxFtRef.current    = null;
                boxStartRef.current = null;
                if (boxFt) boxSrcRef.current?.removeFeature(boxFt);

                const network = useNetworkStore.getState().currentJsonData;
                if (network && boxFt) {
                    const extent = (boxFt.getGeometry() as Polygon).getExtent() as Extent;
                    const w = Math.abs(extent[2]! - extent[0]!);
                    const h = Math.abs(extent[3]! - extent[1]!);
                    if (w > 5 && h > 5) {
                        const hitLinkIds: string[] = [];
                        const hitNodeIds: string[] = [];
                        for (const n of network.nodes) {
                            const pt = fromLonLat([n.coordinates.lng, n.coordinates.lat]);
                            if (containsCoordinate(extent, pt)) hitNodeIds.push(String(n.id));
                        }
                        if (hitNodeIds.length === 0) {
                            for (const l of network.links) {
                                const anyInside = l.coordinates.some(c =>
                                    containsCoordinate(extent, fromLonLat([c.lng, c.lat]))
                                );
                                if (anyInside) hitLinkIds.push(String(l.id));
                            }
                        }
                        if (hitNodeIds.length > 0) {
                            useNetworkDrawStore.getState().setSelectedNodeIds(hitNodeIds);
                            useNetworkToolbarStore.getState().show({ x: e.clientX, y: e.clientY }, 'node', {});
                            useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${hitNodeIds.length}개 선택됨` });
                        } else if (hitLinkIds.length > 0) {
                            useNetworkDrawStore.getState().setSelectedLinkIds(hitLinkIds);
                            useNetworkToolbarStore.getState().show({ x: e.clientX, y: e.clientY }, 'link', {});
                            useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${hitLinkIds.length}개 선택됨` });
                        }
                    }
                }
                return;
            }

            const drag = dragStateRef.current;
            dragStateRef.current = null;
            if (!drag) return;
            if (!drag.moved) {
                // 핸들 단순 클릭(무이동) → 커밋 없이 종료. 삽입 정점 프리뷰는 원상 복구.
                if (drag.type === 'vertex' && drag.inserted && editSrcRef.current) {
                    const net0 = useNetworkStore.getState().currentJsonData;
                    const link0 = net0?.links.find(l => String(l.id) === String(drag.linkId));
                    if (link0) linkEditRef.current = buildLinkEditFeatures(editSrcRef.current, link0.coordinates);
                }
                return;
            }

            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;

            if (drag.type === 'vertex') {
                // 끝점 스냅 적용 체크
                const res = olMap.getView().getResolution() ?? 1;
                const lastPos = drag.workingCoords[drag.vertexIdx]!;
                if (drag.isEndpoint) {
                    const snapNode = findNearestNode(
                        cur.nodes.filter(n => {
                            const link = cur.links.find(l => String(l.id) === String(drag.linkId));
                            if (!link) return true;
                            const ownId = drag.vertexIdx === 0 ? String(link.fromNode) : String(link.toNode);
                            return String(n.id) !== ownId;
                        }),
                        fromLonLat([lastPos.lng, lastPos.lat]), res * 25,
                    );
                    if (snapNode) drag.workingCoords[drag.vertexIdx] = snapNode.coordinates;
                }
                const newNet = updateLinkCoordinates(cur, drag.linkId, drag.workingCoords);
                applyNetworkUpdate(newNet);
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: drag.inserted ? `링크 ${drag.linkId}에 정점 추가됨` : `링크 ${drag.linkId} 형상 수정됨`,
                });
                // OL 하이라이트 + 편집 핸들 즉시 갱신
                const selSrc = selSrcRef.current, hoverSrc = hoverSrcRef.current, editSrc2 = editSrcRef.current;
                const { selectedLinkId: sl } = useNetworkDrawStore.getState();
                if (selSrc && hoverSrc) renderHighlight(selSrc, hoverSrc, newNet, sl, null, null, null);
                if (editSrc2) {
                    const updatedLink = newNet.links.find(l => String(l.id) === String(drag.linkId));
                    if (updatedLink) linkEditRef.current = buildLinkEditFeatures(editSrc2, updatedLink.coordinates);
                }
            } else {
                const newNet = moveNode(cur, drag.nodeId, drag.workingCoord);
                applyNetworkUpdate(newNet);
                useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${drag.nodeId} 이동됨` });
                // OL 하이라이트 + 편집 핸들 즉시 갱신
                const selSrc = selSrcRef.current, hoverSrc = hoverSrcRef.current, editSrc2 = editSrcRef.current;
                const { selectedNodeId: sn } = useNetworkDrawStore.getState();
                if (selSrc && hoverSrc) renderHighlight(selSrc, hoverSrc, newNet, null, sn, null, null);
                if (editSrc2) {
                    const updatedNode = newNet.nodes.find(n => String(n.id) === String(drag.nodeId));
                    if (updatedNode) nodeEditRef.current = buildNodeEditFeatures(editSrc2, updatedNode);
                }
            }
        };
        document.addEventListener('pointerup', onPointerUp, true);

        // ──────────────────── click (선택) ────────────────────
        const onClick = (e: MouseEvent) => {
            if (dragStateRef.current) return;
            // 지도 팬 드래그 후 발화하는 click 은 선택으로 처리하지 않음 —
            // 팬이 링크를 선택해버리면 다음 팬 down 이 그 링크 위일 때
            // 세그먼트 드래그(정점 추가·이동)로 둔갑해 도로 형상이 왜곡된다 (실사용 재현)
            if (panStartPxRef.current) {
                const d = Math.hypot(e.clientX - panStartPxRef.current[0], e.clientY - panStartPxRef.current[1]);
                if (d > 5) return;
            }
            // 핸들/세그먼트/노드 드래그 직후 발화하는 click 억제 (이동 5px 초과 = 드래그였음).
            // 무이동 핸들 클릭은 통과 → 아래 선택/드릴 로직이 정상 동작.
            if (dragDownPxRef.current) {
                const [dx0, dy0] = dragDownPxRef.current;
                dragDownPxRef.current = null;
                if (Math.hypot(e.clientX - dx0, e.clientY - dy0) > 5) return;
            }
            e.stopPropagation();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const coord = olMap.getEventCoordinate(e);
            const res   = olMap.getView().getResolution() ?? 1;

            // 우선순위: 노드 마커 직접 클릭(res*8) > 레인(detail) > 링크 > 노드 근접 폴백(res*20).
            // 노드를 res*20 절대 우선으로 두면, 노드는 링크 끝점 위에 있으므로 교차로 부근
            // 20px 안의 레인/링크 클릭이 전부 노드로 가로채였다("레인 클릭했는데 노드 선택됨").
            // 마커를 정확히 짚은 클릭만 노드 즉시 선택, 그 외엔 도로 요소 우선.
            const nodeCand = findNearestNode(network.nodes, coord, res * 20);
            const nodeDist = nodeCand
                ? olDist(fromLonLat([nodeCand.coordinates.lng, nodeCand.coordinates.lat]), coord)
                : Infinity;
            const isDetail = getNetworkLodTierByResolution(res) === 'detail';
            const directNode = nodeCand && nodeDist <= res * 8 ? nodeCand : null;
            const lane = !directNode && isDetail ? findNearestLane(network.links, coord, res * 8) : null;
            const link = (!directNode && !lane) ? findNearestLink(network.links, coord, res * 15) : null;
            const node = directNode ?? ((!lane && !link) ? nodeCand : null); // 도로 요소 없을 때만 근접 폴백

            // Shift+클릭뿐 아니라 Ctrl(윈도우)/Cmd(맥)+클릭도 동일하게 멀티셀렉트 토글로
            // 취급한다 — 보편적인 편집 툴 관례(Ctrl/Cmd+클릭=개별 항목 토글)에 맞추려는
            // 실사용 요청. 빈 지형에서 Ctrl+드래그로 박스 선택을 시작하는 기존 동작(위
            // pointerdown 핸들러)과는 충돌하지 않는다 — 그건 "빈 곳"에서만 발동하고, 여기는
            // 노드/링크를 실제로 맞혔을 때만 발동하는 별개 경로다.
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                // Shift/Ctrl/Cmd+클릭: 멀티셀렉트 토글 (레인은 멀티셀렉트 미지원 → 링크로)
                // 맥락 툴바는 selectedLinkIds/selectedNodeIds 개수를 직접 보고 멀티선택 바를
                // 그리므로, 여기선 위치만 갱신해두면(level은 무시됨) 계속 같은 지점에 뜬다.
                if (node) {
                    useNetworkDrawStore.getState().toggleSelectedNodeId(String(node.id));
                    const { selectedNodeIds } = useNetworkDrawStore.getState();
                    if (selectedNodeIds.length > 0) useNetworkToolbarStore.getState().show({ x: e.clientX, y: e.clientY }, 'node', {});
                    else useNetworkToolbarStore.getState().hide();
                    return;
                }
                if (link) {
                    useNetworkDrawStore.getState().toggleSelectedLinkId(String(link.id));
                    const { selectedLinkIds } = useNetworkDrawStore.getState();
                    if (selectedLinkIds.length > 0) useNetworkToolbarStore.getState().show({ x: e.clientX, y: e.clientY }, 'link', {});
                    else useNetworkToolbarStore.getState().hide();
                    return;
                }
                return;
            }

            // 선택 시 drawStore(하이라이트/편집핸들) + usePropertyStore(속성창 PropertyModal) +
            // 맥락 툴바(클릭 지점에 뜨는 작은 버튼바) 동시 세팅.
            //   MVT 라 링크/레인은 OL 피처 히트(handleOLSelect)로 못 잡혀 여기서 데이터 기반으로 세팅.
            const setProps = usePropertyStore.getState().setSelectedProps;
            const clickPos = { x: e.clientX, y: e.clientY };
            if (node) {
                useNetworkDrawStore.getState().setSelectedNode(node.id);
                setProps({ ...node, featureType: 'nodes' } as any);
                useNetworkToolbarStore.getState().show(clickPos, 'node', { nodeId: String(node.id) });
                return;
            }
            // 도로 위(레인 히트) → 항상 링크 레벨 툴바를 띄우되, 클릭한 레인/위치를 세션에 담아둔다.
            // 툴바의 "차선보기" 버튼이 재클릭 없이 이 정보로 바로 레인 단계까지 들어간다.
            if (lane) {
                const link0 = network.links.find(l => String(l.id) === lane.linkId);
                if (link0) {
                    const ll = toLonLat(coord);
                    useNetworkDrawStore.getState().setSelectedLink(link0.id);
                    setProps({ ...link0, featureType: 'links' } as any);
                    useNetworkToolbarStore.getState().show(
                        clickPos, 'link',
                        { linkId: String(link0.id), laneIdx: lane.laneIdx },
                        { hitFrac: lane.frac, clickCoord: { lng: ll[0]!, lat: ll[1]! } },
                    );
                    return;
                }
            }
            if (link) {
                const ll = toLonLat(coord);
                useNetworkDrawStore.getState().setSelectedLink(link.id);
                setProps({ ...link, featureType: 'links' } as any);
                useNetworkToolbarStore.getState().show(
                    clickPos, 'link',
                    { linkId: String(link.id) },
                    { clickCoord: { lng: ll[0]!, lat: ll[1]! } },
                );
                return;
            }
            useNetworkDrawStore.getState().clearSelection();
            usePropertyStore.getState().setSelectedProps(null);
            useNetworkToolbarStore.getState().hide();

            // Alt+빈 지형 클릭: "도로를 그리는 게 아니라 노드 하나만 놓고 싶다"는 실사용 요청 —
            // 도로 그리기(beginDrawAt)로 자동 전환하지 않고 항상 고립 노드만 놓는다.
            // ⚠️ 2026-07-29: 처음엔 여기서 근처 링크에 자동 스냅해 바로 분할·연결까지 했으나,
            // 실사용 피드백으로 자동 추측 연결을 제거 — 어떤 도로에 연결할지는 노드를 놓은 뒤
            // 노드 컨텍스트 툴바의 "🔗 링크 연결" 버튼으로 명시적으로 링크를 선택해 정하도록
            // 바꿨다(NetworkEditToolbar의 connectTargetNodeId 흐름, connectNodeToLinks 참고).
            // 실제 네트워크 변경은 useNetworkDraw.ts의 전용 effect가 pendingNodePlacement를
            // 소비해 수행(beginDrawAt/pendingStartCoord와 동일한 분업).
            if (e.altKey) {
                const ll = toLonLat(coord);
                useNetworkDrawStore.getState().placeNodeAt(
                    { lng: ll[0]!, lat: ll[1]! },
                    { x: e.clientX, y: e.clientY },
                );
                return;
            }

            // 선택 모드에서 도로/노드가 하나도 없는 빈 지형을 클릭 — 보통 "여기서부터 새 도로를
            // 그리고 싶다"는 의도라 실사용 요청으로 그리기 모드로 자동 전환한다. beginDrawAt이
            // 이 클릭 좌표를 draw effect의 시작점으로 직접 주입하므로 재클릭 없이 바로 그려진다.
            const ll = toLonLat(coord);
            useNetworkDrawStore.getState().beginDrawAt({ lng: ll[0]!, lat: ll[1]! });
        };
        vp.addEventListener('click', onClick, true);

        // ──────────────────── 키보드 ──────────────────────────
        const onKey = (e: KeyboardEvent) => {
            const { selectedLinkId: sl, selectedNodeId: sn,
                    selectedLinkIds, selectedNodeIds } = useNetworkDrawStore.getState();
            if (e.key === 'Escape') {
                // "링크 연결" 대상 선택 중이었다면 그 모드부터 취소(일반 선택 해제와 별개 상태).
                if (useNetworkDrawStore.getState().connectTargetNodeId) {
                    useNetworkDrawStore.getState().clearConnectTarget();
                }
                useNetworkDrawStore.getState().clearSelection();
                useNetworkToolbarStore.getState().hide();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                // 삭제는 편집 조작 → 선택 모드 전용(보기모드는 선택만).
                if (!useNetworkDrawStore.getState().isSelectActive) return;
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const beforeLinkIds = new Set(network.links.map(l => String(l.id)));
                const beforeNodeIds = new Set(network.nodes.map(n => String(n.id)));
                // 삭제 후 사라진 링크/노드 id 마킹 — 링크는 MVT 마스킹, 노드는 타일 동기화 제외
                // (마킹 없으면 다음 동기화에서 서버 타일이 삭제 노드를 되살림)
                const markDeleted = () => {
                    const cur = useNetworkStore.getState().currentJsonData;
                    const afterLinks = new Set((cur?.links ?? []).map(l => String(l.id)));
                    const afterNodes = new Set((cur?.nodes ?? []).map(n => String(n.id)));
                    const removedLinks = [...beforeLinkIds].filter(id => !afterLinks.has(id));
                    const removedNodes = [...beforeNodeIds].filter(id => !afterNodes.has(id));
                    if (removedLinks.length > 0) useNetworkEditStore.getState().addDeleted(removedLinks);
                    if (removedNodes.length > 0) useNetworkEditStore.getState().addDeletedNodes(removedNodes);
                    return removedLinks;
                };
                // 멀티셀렉트 일괄 삭제
                if (selectedLinkIds.length > 0) {
                    const affectedNodeIds = new Set(
                        network.links
                            .filter(l => selectedLinkIds.includes(String(l.id)))
                            .flatMap(l => [String(l.fromNode), String(l.toNode)])
                    );
                    // 정류장은 link 삭제로 완전히 사라지는 레코드(신호처럼 참조만 비울 수
                    // 없음) — 파괴적 연쇄라 다른 삭제 확인들과 동일하게 사전에 알린다.
                    const stationCount = countStationsForLinks(selectedLinkIds);
                    const proceedDelete = () => {
                        // 확인 다이얼로그를 거치는 동안 network가 바뀌었을 수 있어 최신본을 다시 읽는다
                        // (doDelete와 동일 원칙 — 클로저로 캡처한 network는 confirm 클릭 시점엔 낡았을 수 있음).
                        const net = useNetworkStore.getState().currentJsonData;
                        if (!net) return;
                        const next = batchDeleteLinksFromNetwork(net, selectedLinkIds);
                        applyNetworkUpdate(next);
                        const clearedCount = reconcileSignalConnectionIds(next, [...affectedNodeIds]);
                        const removedLinks = markDeleted();
                        const removedStationCount = deleteStationsForLinks(removedLinks);
                        const removedMarkingCount = deletePavementMarkingsForLinks(removedLinks);
                        useNetworkDrawStore.getState().clearSelection();
                        useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${selectedLinkIds.length}개 삭제됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}` });
                    };
                    if (stationCount > 0) {
                        useMessageStore.getState().setMessage({
                            type: 'confirm',
                            text: `링크 ${selectedLinkIds.length}개를 삭제합니다. 이 링크 위 정류장 ${stationCount}개도 함께 삭제됩니다. 계속할까요?`,
                            onConfirm: proceedDelete,
                        });
                    } else {
                        proceedDelete();
                    }
                } else if (selectedNodeIds.length > 0) {
                    // 연쇄 삭제 확인 — 통과 노드(in1+out1, 차선수 동일)는 링크 자동 병합, 나머지는 연결 링크·커넥션·신호·정류장까지 cascade
                    const mergeCount = selectedNodeIds.filter(id => isPassThroughNode(network, id)).length;
                    const linkedCount = countLinksLostForNodes(network, selectedNodeIds);
                    const signalCount = countSignalsForNodes(selectedNodeIds);
                    const stationCount = countStationsForNodes(network, selectedNodeIds);
                    const doDelete = () => {
                        const net = useNetworkStore.getState().currentJsonData;
                        if (!net) return;
                        const farIds = farNodeIdsForCascadeDelete(net, selectedNodeIds);
                        const next = batchDeleteOrMergeNodes(net, selectedNodeIds);
                        applyNetworkUpdate(next);
                        const clearedCount = reconcileSignalConnectionIds(next, farIds);
                        deleteSignalsForNodes(selectedNodeIds);
                        const removedLinks = markDeleted();
                        const removedStationCount = deleteStationsForLinks(removedLinks);
                        const removedMarkingCount = deletePavementMarkingsForLinks(removedLinks);
                        useNetworkDrawStore.getState().clearSelection();
                        useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${selectedNodeIds.length}개 삭제됨${mergeCount > 0 ? ` (통과 노드 ${mergeCount}개는 링크 자동 병합)` : ''}${signalCount > 0 ? `, 신호 ${signalCount}개 삭제` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}${clearedCount > 0 ? `, 인접 신호 ${clearedCount}개 커넥션 참조 초기화` : ''}` });
                    };
                    if (linkedCount > 0 || signalCount > 0 || stationCount > 0) {
                        useMessageStore.getState().setMessage({
                            type: 'confirm',
                            text: `노드 ${selectedNodeIds.length}개를 삭제합니다.${linkedCount > 0 ? ` 연결 링크 ${linkedCount}개가 함께 삭제되고,` : ''}${mergeCount > 0 ? ` 통과 노드 ${mergeCount}개는 링크가 자동 병합되며,` : ''}${signalCount > 0 ? ` 신호 ${signalCount}개도 삭제됩니다.` : ''}${stationCount > 0 ? ` 정류장 ${stationCount}개도 삭제됩니다.` : ''} 계속할까요?`,
                            onConfirm: doDelete,
                        });
                    } else {
                        doDelete();
                    }
                } else if (sl !== null) {
                    const delLink = network.links.find(l => String(l.id) === String(sl));
                    const stationCount = countStationsForLinks([sl]);
                    const proceedDelete = () => {
                        // 확인 다이얼로그를 거치는 동안 network가 바뀌었을 수 있어 최신본을 다시 읽는다.
                        const net = useNetworkStore.getState().currentJsonData;
                        if (!net) return;
                        const next = deleteLinkFromNetwork(net, sl);
                        applyNetworkUpdate(next);
                        const clearedCount = delLink ? reconcileSignalConnectionIds(next, [delLink.fromNode, delLink.toNode]) : 0;
                        const removedLinks = markDeleted();
                        const removedStationCount = deleteStationsForLinks(removedLinks);
                        const removedMarkingCount = deletePavementMarkingsForLinks(removedLinks);
                        useNetworkDrawStore.getState().clearSelection();
                        useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${sl} 삭제됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}` });
                    };
                    if (stationCount > 0) {
                        useMessageStore.getState().setMessage({
                            type: 'confirm',
                            text: `링크 ${sl}을(를) 삭제합니다. 이 링크 위 정류장 ${stationCount}개도 함께 삭제됩니다. 계속할까요?`,
                            onConfirm: proceedDelete,
                        });
                    } else {
                        proceedDelete();
                    }
                } else if (sn !== null) {
                    const passThrough = isPassThroughNode(network, sn);
                    const linkedCount = countLinksLostForNodes(network, [sn]);
                    const signalCount = countSignalsForNodes([sn]);
                    const stationCount = countStationsForNodes(network, [sn]);
                    const doDelete = () => {
                        const net = useNetworkStore.getState().currentJsonData;
                        if (!net) return;
                        const merged = mergeLinksAtNode(net, sn);
                        const farIds = merged ? [] : farNodeIdsForCascadeDelete(net, [sn]);
                        const next = merged ?? deleteNodeFromNetwork(net, sn);
                        applyNetworkUpdate(next);
                        const clearedCount = reconcileSignalConnectionIds(next, farIds);
                        deleteSignalsForNodes([sn]);
                        const removedLinks = markDeleted();
                        const removedStationCount = deleteStationsForLinks(removedLinks);
                        const removedMarkingCount = deletePavementMarkingsForLinks(removedLinks);
                        useNetworkDrawStore.getState().clearSelection();
                        useMessageStore.getState().setMessage({
                            type: 'info',
                            text: (merged
                                ? `노드 ${sn} 삭제 및 인접 링크 자동 병합됨${signalCount > 0 ? ` (신호 ${signalCount}개 삭제)` : ''}`
                                : `노드 ${sn} 및 연결 링크 ${linkedCount}개${signalCount > 0 ? `, 신호 ${signalCount}개` : ''} 삭제됨`)
                                + (removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : '')
                                + (removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : '')
                                + (clearedCount > 0 ? `, 인접 신호 ${clearedCount}개 커넥션 참조 초기화` : ''),
                        });
                    };
                    if (linkedCount > 0 || signalCount > 0 || stationCount > 0) {
                        useMessageStore.getState().setMessage({
                            type: 'confirm',
                            text: passThrough
                                ? `노드 ${sn}은(는) 통과 노드로 판단되어 인접 링크가 자동 병합됩니다.${signalCount > 0 ? ` 신호 ${signalCount}개는 삭제됩니다.` : ''}${stationCount > 0 ? ` 정류장 ${stationCount}개도 삭제됩니다.` : ''} 계속할까요?`
                                : `노드 ${sn}을(를) 삭제하면 연결된 링크 ${linkedCount}개, 커넥션${signalCount > 0 ? `, 신호 ${signalCount}개` : ''}${stationCount > 0 ? `, 정류장 ${stationCount}개` : ''}도 함께 삭제됩니다. 계속할까요?`,
                            onConfirm: doDelete,
                        });
                    } else {
                        doDelete();
                    }
                }
            }
        };
        document.addEventListener('keydown', onKey);

        return () => {
            vp.removeEventListener('contextmenu', onContextMenu, true);
            vp.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerUp, true);
            vp.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [olMap, isSelectActive]);

    // ── 멀티셀렉트 하이라이트 렌더링 ────────────────────────────
    useEffect(() => {
        const multiSrc = multiSrcRef.current;
        if (!multiSrc || !isSelectActive) return;
        const network = useNetworkStore.getState().currentJsonData;
        multiSrc.clear();
        if (!network) return;

        for (const lid of selectedLinkIds) {
            const link = network.links.find(l => String(l.id) === lid);
            if (!link) continue;
            const ft = new Feature(new LineString(link.coordinates.map(c => fromLonLat([c.lng, c.lat]))));
            ft.setStyle(multiSelectLinkStyle);
            multiSrc.addFeature(ft);
        }
        for (const nid of selectedNodeIds) {
            const node = network.nodes.find(n => String(n.id) === nid);
            if (!node) continue;
            const ft = new Feature(new Point(fromLonLat([node.coordinates.lng, node.coordinates.lat])));
            ft.setStyle(multiSelectNodeStyle);
            multiSrc.addFeature(ft);
        }
    }, [isSelectActive, selectedLinkIds, selectedNodeIds]);

    // ── Cesium 편집 핸들 DataSource 참조 ───────────────────────────
    const cesiumHandleDsRef = useRef<Cesium.CustomDataSource | null>(null);

    // ── Cesium 편집 핸들 생성/갱신 (선택 변경 시) ──────────────────
    useEffect(() => {
        if (!viewer || !isSelectActive) return;

        // DataSource 초기화 (처음 진입 시)
        if (!cesiumHandleDsRef.current) {
            const ds = new Cesium.CustomDataSource('networkEditHandles');
            viewer.dataSources.add(ds);
            cesiumHandleDsRef.current = ds;
        }
        const ds = cesiumHandleDsRef.current;
        ds.entities.removeAll();

        const network = useNetworkStore.getState().currentJsonData;
        if (!network) return;

        // 링크 선택: 꼭짓점 핸들 구체 표시
        if (selectedLinkId !== null) {
            const link = network.links.find(l => String(l.id) === String(selectedLinkId));
            if (link) {
                link.coordinates.forEach((c, i) => {
                    const isEndpoint = i === 0 || i === link.coordinates.length - 1;
                    ds.entities.add(new Cesium.Entity({
                        position: Cesium.Cartesian3.fromDegrees(c.lng, c.lat),
                        ellipsoid: {
                            radii: new Cesium.Cartesian3(isEndpoint ? 4 : 2.5, isEndpoint ? 4 : 2.5, isEndpoint ? 4 : 2.5),
                            material: isEndpoint
                                ? Cesium.Color.fromCssColorString('#7aa2ff').withAlpha(0.95)
                                : Cesium.Color.WHITE.withAlpha(0.9),
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        properties: { handleType: 'vertex', vertexIdx: i },
                    }));
                });
            }
        }

        // 노드 선택: 이동 핸들 표시
        if (selectedNodeId !== null) {
            const node = network.nodes.find(n => String(n.id) === String(selectedNodeId));
            if (node) {
                ds.entities.add(new Cesium.Entity({
                    position: Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat),
                    ellipsoid: {
                        radii: new Cesium.Cartesian3(5, 5, 5),
                        material: Cesium.Color.fromCssColorString('#4080ff').withAlpha(0.9),
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    },
                    properties: { handleType: 'node' },
                }));
            }
        }

        try { viewer.scene.requestRender(); } catch (_) {}
    }, [viewer, isSelectActive, selectedLinkId, selectedNodeId]);

    // ── Cesium 편집 DataSource 해제 (선택 모드 종료 시) ────────────
    useEffect(() => {
        if (isSelectActive) return;
        if (cesiumHandleDsRef.current && viewer) {
            viewer.dataSources.remove(cesiumHandleDsRef.current, true);
            cesiumHandleDsRef.current = null;
        }
    }, [isSelectActive, viewer]);

    // ── Cesium 카메라: 선택 모드에서도 이동 허용 (Ctrl+drag만 편집) ─
    // (별도 차단 없음 — Ctrl+drag 시에만 일시 차단)

    // ── Cesium 클릭 선택 (LEFT_CLICK, 수식키 없음) ──────────────────
    useEffect(() => {
        if (!isSelectActive || !viewer) return;
        const v       = viewer;
        const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);

        handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const scene     = v.scene;
            const drawStore = useNetworkDrawStore.getState();

            // 1순위: scene.pick() — Entity(노드)만 신뢰
            // 줌 중 LOD tier 전환으로 GroundPrimitive 가 비동기 재생성되는 순간과 겹치면
            // Cesium 내부에서 scene.pick() 자체가 예외를 던질 수 있어 방어 (defaultEventHandler.ts 참고)
            let picked: any;
            try {
                picked = scene.pick(e.position);
            } catch (_) {
                picked = undefined;
            }
            if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
                const props = picked.id.properties?.getValue(Cesium.JulianDate.now());
                if (props?.featureType === 'nodes' && props?.id != null) {
                    drawStore.setSelectedNode(String(props.id));
                    return;
                }
            }

            // 링크: 분류볼륨 scene.pick 은 보이는 것과 어긋남 → 지면점 기하 탐색
            const hit = pickNetworkAtPosition(scene, e.position);
            if (hit?.props?.id != null) {
                drawStore.setSelectedLink(String(hit.props.id));
                return;
            }

            // 2순위: 화면거리 기반 fallback
            const node = findNearestNodeCesium(network.nodes, e.position, scene, 25);
            if (node) { drawStore.setSelectedNode(node.id); return; }
            const link = findNearestLinkCesium(network.links, e.position, scene, 15);
            if (link) { drawStore.setSelectedLink(link.id); return; }
            drawStore.clearSelection();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        return () => { handler.destroy(); };
    }, [isSelectActive, viewer]);
};

// ══════════════════════════════════════════════════════════════════
// 공통 업데이트
// ══════════════════════════════════════════════════════════════════

/**
 * 타일 모드 삭제 마스킹: 변경 전후 diff 로 사라진 링크/노드를 편집 스토어에 마킹.
 * 링크 → MVT 렌더 숨김, 노드 → 타일 동기화 제외(마킹 없으면 서버 타일이 되살림).
 * 삭제·분할·병합 등 요소가 사라지는 모든 조작 후 호출.
 */
export function markRemovedForTileMask(before: Network, after: Network): void {
    const afterLinks = new Set(after.links.map(l => String(l.id)));
    const afterNodes = new Set(after.nodes.map(n => String(n.id)));
    const removedLinks = before.links.filter(l => !afterLinks.has(String(l.id))).map(l => String(l.id));
    const removedNodes = before.nodes.filter(n => !afterNodes.has(String(n.id))).map(n => String(n.id));
    if (removedLinks.length > 0) useNetworkEditStore.getState().addDeleted(removedLinks);
    if (removedNodes.length > 0) useNetworkEditStore.getState().addDeletedNodes(removedNodes);
}

export function applyNetworkUpdate(network: Network) {
    const current = useNetworkStore.getState().currentJsonData;
    if (current) useNetworkUndoStore.getState().push(current);
    assignPropertyToResponseData(network as any);
    useNetworkStore.getState().setCurrentJsonData(network);
    useNetworkStore.getState().setChange(true);
}
