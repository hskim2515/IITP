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
import { useMessageStore } from '@stores/useMessageStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { getNetworkLodTierByResolution } from '@utils/lodConstants';
import { useModeStore } from '@stores/useModeStore';
import { usePropertyStore } from '@stores/usePropertyStore';
import { Network, Link, Node, Lane, Coordinates } from '@type/Network';
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
        const d = olDist(fromLonLat([n.coordinates.lng, n.coordinates.lat]), coord);
        if (d < minD) { minD = d; best = n; }
    }
    return best;
}

export function findNearestLink(links: Link[], coord: Coordinate, threshold: number): Link | null {
    let best: Link | null = null, minD = threshold;
    for (const link of links) {
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
export function findNearestLane(links: Link[], coord: Coordinate, threshold: number): { linkId: string; laneIdx: number } | null {
    let best: { linkId: string; laneIdx: number } | null = null;
    let minD = threshold;
    for (const link of links) {
        const lanes = link.lanes ?? [];
        const laneCount = lanes.length;
        if (laneCount === 0) continue;
        const laneW = (link.width ?? 7) / laneCount;
        const c = link.coordinates;
        // 링크 중심선을 3857 점 배열로 (세그먼트별 법선 계산용)
        const pts = c.map(p => fromLonLat([p.lng, p.lat]));
        for (let li = 0; li < laneCount; li++) {
            const off = ((laneCount - 1) / 2 - li) * laneW; // 레인 중심 오프셋(m≈3857 단위, 저위도 근사)
            for (let si = 0; si < pts.length - 1; si++) {
                const a = pts[si]!, b = pts[si + 1]!;
                const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                const nx = -dy / len, ny = dx / len; // 세그먼트 법선(단위)
                const oa = [a[0]! + nx * off, a[1]! + ny * off];
                const ob = [b[0]! + nx * off, b[1]! + ny * off];
                const odx = ob[0] - oa[0], ody = ob[1] - oa[1];
                const len2 = odx * odx + ody * ody;
                if (len2 < 1e-10) continue;
                const t = Math.max(0, Math.min(1, ((coord[0]! - oa[0]) * odx + (coord[1]! - oa[1]) * ody) / len2));
                const d = olDist([oa[0] + t * odx, oa[1] + t * ody], coord);
                if (d < minD) { minD = d; best = { linkId: String(link.id), laneIdx: li }; }
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

    // width/numLane 변경 → 레인 오프셋 변화 → conn.coordinates stale
    const laneLayoutChanged = patch.width !== undefined || patch.numLane !== undefined;
    const updatedNodes = laneLayoutChanged
        ? network.nodes.map(n => {
            if (String(n.id) !== String(link.fromNode) && String(n.id) !== String(link.toNode)) return n;
            return { ...n, connections: n.connections.map((c: any) => ({ ...c, coordinates: [] })) };
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
    const endpointMoved =
        newFrom.lng !== oldFrom?.lng || newFrom.lat !== oldFrom?.lat ||
        newTo.lng   !== oldTo?.lng   || newTo.lat   !== oldTo?.lat;

    const updatedLinks = network.links.map(l => {
        if (String(l.id) !== String(linkId)) return l;
        return {
            ...l, coordinates: newCoords, length,
            lanes: l.lanes.map((lane: any) => ({
                ...lane,
                coordinates: newCoords,
                numCell: Math.max(1, Math.ceil(length / 100)), // 길이 변경 반영(cells 는 빈 배열 유지=서버 생성)
                segments: [{ ...lane.segments[0], initPoint: 0, endPoint: length }],
            })),
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
        if (String(l.fromNode) === String(removeNodeId)) { fromNode = keepNodeId as number; coords = [keepCoord, ...coords.slice(1)]; }
        if (String(l.toNode)   === String(removeNodeId)) { toNode   = keepNodeId as number; coords = [...coords.slice(0, -1), keepCoord]; }
        if (fromNode === l.fromNode && toNode === l.toNode) return l;
        return { ...l, fromNode, toNode, coordinates: coords, length: calcPathLength(coords) };
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
        // 레인 coordinates는 link.coordinates를 따르므로 동일하게 업데이트
        return {
            ...l, coordinates: coords, length,
            lanes: l.lanes.map((lane: any) => ({
                ...lane,
                coordinates: coords,
                segments: [{ ...lane.segments[0], initPoint: 0, endPoint: length }],
            })),
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
type DragState = {
    type: 'vertex';
    linkId: string | number;
    vertexIdx: number;
    workingCoords: Coordinates[];
    isEndpoint: boolean;
} | {
    type: 'node';
    nodeId: string | number;
    workingCoord: Coordinates;
};

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
    const appMode        = useModeStore(s => s.appMode); // 모드 전환 시 선택 초기화용

    // (구) 선택 편집 진입 시 mapViewMode='2D' 강제 로직 제거 — 편집모드는 split(2D 편집 + 3D 로드뷰)
    //   유지. 편집은 2D(OL) 전용이라 뷰 강제 불필요.

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
        const selSrc   = selSrcRef.current;
        const hoverSrc = hoverSrcRef.current;
        const editSrc  = editSrcRef.current;
        if (!selSrc || !hoverSrc || !editSrc) return;

        const network = useNetworkStore.getState().currentJsonData;
        if (!network) return;

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
    }, [selectedLinkId, selectedNodeId, selectedLaneId, isSelectActive]);

    // 모드 전환(보기↔편집) 시 선택 초기화 (확정 요구사항)
    useEffect(() => {
        useNetworkDrawStore.getState().clearSelection();
    }, [appMode]);

    // ── OL 포인터 이벤트 (선택 + Ctrl+드래그 편집) ──────────────
    useEffect(() => {
        if (!olMap || !isSelectActive) return; // 편집모드 선택 전용(속성조회는 defaultEventHandler 담당)
        const vp = olMap.getViewport();

        const blockContextMenu = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
        vp.addEventListener('contextmenu', blockContextMenu, true);

        // ──────────────────── pointerdown ──────────────────────
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            // 편집 조작(Ctrl+드래그 꼭짓점/노드 이동, 범위선택)은 선택 모드 전용 — 보기모드는 선택만.
            if (!useNetworkDrawStore.getState().isSelectActive) return;

            // Ctrl 없으면 지도 이동 허용 (드래그 편집 안 함)
            if (!e.ctrlKey) return;

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
                        setDragPan(olMap, false);
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        olMap.getTargetElement().style.cursor = 'grabbing';
                        return;
                    }
                }
            }

            // Ctrl + 빈 공간 → 박스 범위 선택
            if (!e.shiftKey && network) {
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

            // 드래그 아닌 hover — Ctrl 키 + 핸들 근처면 grab 커서
            const { selectedLinkId: sl, selectedNodeId: sn } = useNetworkDrawStore.getState();

            if (e.ctrlKey) {
                if (sl !== null && linkEditRef.current && network) {
                    const link = network.links.find(l => String(l.id) === String(sl));
                    if (link) {
                        const onHandle = link.coordinates.some(
                            c => olDist(fromLonLat([c.lng, c.lat]), coord) < res * 22
                        );
                        olMap.getTargetElement().style.cursor = onHandle ? 'grab' : 'crosshair';
                        return;
                    }
                }
                if (sn !== null && nodeEditRef.current && network) {
                    const node = network.nodes.find(n => String(n.id) === String(sn));
                    if (node) {
                        const onHandle = olDist(fromLonLat([node.coordinates.lng, node.coordinates.lat]), coord) < res * 22;
                        olMap.getTargetElement().style.cursor = onHandle ? 'grab' : 'crosshair';
                        return;
                    }
                }
                olMap.getTargetElement().style.cursor = 'crosshair';
                return;
            } else {
                // Ctrl 없음: 기본 커서 (지도 이동 가능)
                olMap.getTargetElement().style.cursor = 'default';
            }

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
                            useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${hitNodeIds.length}개 선택됨` });
                        } else if (hitLinkIds.length > 0) {
                            useNetworkDrawStore.getState().setSelectedLinkIds(hitLinkIds);
                            useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${hitLinkIds.length}개 선택됨` });
                        }
                    }
                }
                return;
            }

            const drag = dragStateRef.current;
            dragStateRef.current = null;
            if (!drag) return;

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
                useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${drag.linkId} 형상 수정됨` });
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
            e.stopPropagation();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const coord = olMap.getEventCoordinate(e);
            const res   = olMap.getView().getResolution() ?? 1;

            // 이미 선택된 요소 핸들 클릭이면 무시 (드래그용)
            const { selectedLinkId: sl, selectedNodeId: sn } = useNetworkDrawStore.getState();
            if (sl !== null && linkEditRef.current) {
                const link = network.links.find(l => String(l.id) === String(sl));
                if (link?.coordinates.some(c => olDist(fromLonLat([c.lng, c.lat]), coord) < res * 18)) return;
            }
            if (sn !== null && nodeEditRef.current) {
                const node = network.nodes.find(n => String(n.id) === String(sn));
                if (node && olDist(fromLonLat([node.coordinates.lng, node.coordinates.lat]), coord) < res * 18) return;
            }

            // 우선순위: 노드 > 레인(detail 줌에서만) > 링크. 레인은 링크보다 세밀하니 먼저.
            const node = findNearestNode(network.nodes, coord, res * 20);
            const isDetail = getNetworkLodTierByResolution(res) === 'detail';
            const lane = !node && isDetail ? findNearestLane(network.links, coord, res * 8) : null;
            const link = (!node && !lane) ? findNearestLink(network.links, coord, res * 15) : null;

            if (e.shiftKey) {
                // Shift+클릭: 멀티셀렉트 토글 (레인은 멀티셀렉트 미지원 → 링크로)
                if (node) { useNetworkDrawStore.getState().toggleSelectedNodeId(String(node.id)); return; }
                if (link) { useNetworkDrawStore.getState().toggleSelectedLinkId(String(link.id)); return; }
                return;
            }

            // 선택 시 drawStore(하이라이트/편집핸들) + usePropertyStore(속성창 PropertyModal) 동시 세팅.
            //   MVT 라 링크/레인은 OL 피처 히트(handleOLSelect)로 못 잡혀 여기서 데이터 기반으로 세팅.
            const setProps = usePropertyStore.getState().setSelectedProps;
            if (node) {
                useNetworkDrawStore.getState().setSelectedNode(node.id);
                setProps({ ...node, featureType: 'nodes' } as any); return;
            }
            if (lane) {
                const link0 = network.links.find(l => String(l.id) === lane.linkId);
                const laneObj = link0?.lanes?.[lane.laneIdx];
                useNetworkDrawStore.getState().setSelectedLane(`${lane.linkId}_${lane.laneIdx}`);
                setProps(laneObj ? { ...laneObj, featureType: 'lanes', linkRef: lane.linkId, laneRef: lane.laneIdx } as any : null); return;
            }
            if (link) {
                useNetworkDrawStore.getState().setSelectedLink(link.id);
                setProps({ ...link, featureType: 'links' } as any); return;
            }
            useNetworkDrawStore.getState().clearSelection();
            usePropertyStore.getState().setSelectedProps(null);
        };
        vp.addEventListener('click', onClick, true);

        // ──────────────────── 키보드 ──────────────────────────
        const onKey = (e: KeyboardEvent) => {
            const { selectedLinkId: sl, selectedNodeId: sn,
                    selectedLinkIds, selectedNodeIds } = useNetworkDrawStore.getState();
            if (e.key === 'Escape') {
                useNetworkDrawStore.getState().clearSelection();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                // 삭제는 편집 조작 → 선택 모드 전용(보기모드는 선택만).
                if (!useNetworkDrawStore.getState().isSelectActive) return;
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                const beforeLinkIds = new Set(network.links.map(l => String(l.id)));
                // 삭제 후 사라진 링크 id 를 MVT 마스킹 대상으로 마킹(노드 삭제 시 연결 링크 포함).
                const markDeleted = () => {
                    const after = new Set((useNetworkStore.getState().currentJsonData?.links ?? []).map(l => String(l.id)));
                    const removed = [...beforeLinkIds].filter(id => !after.has(id));
                    if (removed.length > 0) useNetworkEditStore.getState().addDeleted(removed);
                };
                // 멀티셀렉트 일괄 삭제
                if (selectedLinkIds.length > 0) {
                    applyNetworkUpdate(batchDeleteLinksFromNetwork(network, selectedLinkIds));
                    markDeleted();
                    useNetworkDrawStore.getState().clearSelection();
                    useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${selectedLinkIds.length}개 삭제됨` });
                } else if (selectedNodeIds.length > 0) {
                    applyNetworkUpdate(batchDeleteNodesFromNetwork(network, selectedNodeIds));
                    markDeleted();
                    useNetworkDrawStore.getState().clearSelection();
                    useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${selectedNodeIds.length}개 삭제됨` });
                } else if (sl !== null) {
                    applyNetworkUpdate(deleteLinkFromNetwork(network, sl));
                    markDeleted();
                    useNetworkDrawStore.getState().clearSelection();
                    useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${sl} 삭제됨` });
                } else if (sn !== null) {
                    const node = network.nodes.find(n => String(n.id) === String(sn));
                    applyNetworkUpdate(deleteNodeFromNetwork(network, sn));
                    markDeleted();
                    useNetworkDrawStore.getState().clearSelection();
                    useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${sn} 및 연결 링크 ${node?.ports.length ?? 0}개 삭제됨` });
                }
            }
        };
        document.addEventListener('keydown', onKey);

        return () => {
            vp.removeEventListener('contextmenu', blockContextMenu, true);
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
            const picked = scene.pick(e.position);
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
export function applyNetworkUpdate(network: Network) {
    const current = useNetworkStore.getState().currentJsonData;
    if (current) useNetworkUndoStore.getState().push(current);
    assignPropertyToResponseData(network as any);
    useNetworkStore.getState().setCurrentJsonData(network);
    useNetworkStore.getState().setChange(true);
}
