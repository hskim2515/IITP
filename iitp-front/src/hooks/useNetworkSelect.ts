import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Feature } from 'ol';
import { LineString, Point } from 'ol/geom';
import { Stroke, Fill, Style, Circle as CircleStyle, RegularShape } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import { Coordinate } from 'ol/coordinate';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useMessageStore } from '@stores/useMessageStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { Network, Link, Node, Lane, Coordinates } from '@type/Network';

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

const SEL_Z  = 501;
const EDIT_Z = 504;

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

function findNearestNode(nodes: Node[], coord: Coordinate, threshold: number): Node | null {
    let best: Node | null = null, minD = threshold;
    for (const n of nodes) {
        const d = olDist(fromLonLat([n.coordinates.lng, n.coordinates.lat]), coord);
        if (d < minD) { minD = d; best = n; }
    }
    return best;
}

function findNearestLink(links: Link[], coord: Coordinate, threshold: number): Link | null {
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
    return { ...network, links: network.links.map(l => {
        if (String(l.id) !== String(linkId)) return l;
        const updated = { ...l, ...patch };
        if (patch.numLane !== undefined && patch.numLane !== l.numLane)
            updated.lanes = rebuildLanes(updated, patch.numLane);
        return updated;
    })};
}

export function updateLinkCoordinates(network: Network, linkId: number | string, newCoords: Coordinates[]): Network {
    return { ...network, links: network.links.map(l => {
        if (String(l.id) !== String(linkId)) return l;
        const length = calcPathLength(newCoords);
        const from = newCoords[0]!, to = newCoords[newCoords.length-1]!;
        return { ...l, coordinates: newCoords, length, lanes: l.lanes.map(lane => ({
            ...lane, coordinates: [from, to],
            segments: [{ ...lane.segments[0]!, initPoint: 0, endPoint: length }],
        }))};
    })};
}

export function moveNode(network: Network, nodeId: number | string, newCoord: Coordinates): Network {
    const updatedNodes = network.nodes.map(n =>
        String(n.id) === String(nodeId) ? { ...n, coordinates: newCoord } : n
    );
    const updatedLinks = network.links.map(l => {
        const isFrom = String(l.fromNode) === String(nodeId);
        const isTo   = String(l.toNode)   === String(nodeId);
        if (!isFrom && !isTo) return l;
        const coords = [...l.coordinates];
        if (isFrom) coords[0] = newCoord;
        if (isTo)   coords[coords.length-1] = newCoord;
        const length = calcPathLength(coords);
        const from = coords[0]!, to = coords[coords.length-1]!;
        return { ...l, coordinates: coords, length, lanes: l.lanes.map(lane => ({
            ...lane, coordinates: [from, to],
            segments: [{ ...lane.segments[0]!, initPoint: 0, endPoint: length }],
        }))};
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

function renderHighlight(
    selSrc: VectorSource, hoverSrc: VectorSource, network: Network,
    selectedLinkId: number | string | null, selectedNodeId: number | string | null,
    hoveredLinkId: number | string | null, hoveredNodeId: number | string | null,
) {
    selSrc.clear(); hoverSrc.clear();
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
    const isSelectActive = useNetworkDrawStore(s => s.isSelectActive);
    const selectedLinkId = useNetworkDrawStore(s => s.selectedLinkId);
    const selectedNodeId = useNetworkDrawStore(s => s.selectedNodeId);

    const selSrcRef   = useRef<VectorSource | null>(null);
    const hoverSrcRef = useRef<VectorSource | null>(null);
    const editSrcRef  = useRef<VectorSource | null>(null);

    const hoveredLinkIdRef = useRef<number | string | null>(null);
    const hoveredNodeIdRef = useRef<number | string | null>(null);

    // 편집 피처 참조 (링크 or 노드)
    const linkEditRef = useRef<LinkEditFeatures | null>(null);
    const nodeEditRef = useRef<NodeEditFeatures | null>(null);

    // 드래그 상태
    const dragStateRef = useRef<DragState | null>(null);

    // ── 레이어 생명주기 ──────────────────────────────────────────
    useEffect(() => {
        if (!olMap || !isSelectActive) return;

        const selSrc   = new VectorSource();
        const hoverSrc = new VectorSource();
        const editSrc  = new VectorSource();
        selSrcRef.current   = selSrc;
        hoverSrcRef.current = hoverSrc;
        editSrcRef.current  = editSrc;

        const selLayer   = new VectorLayer({ source: selSrc,   zIndex: SEL_Z });
        const hoverLayer = new VectorLayer({ source: hoverSrc, zIndex: SEL_Z - 1 });
        const editLayer  = new VectorLayer({ source: editSrc,  zIndex: EDIT_Z });
        olMap.addLayer(selLayer);
        olMap.addLayer(hoverLayer);
        olMap.addLayer(editLayer);
        olMap.getTargetElement().style.cursor = 'default';

        return () => {
            useNetworkDrawStore.getState().clearSelection();
            dragStateRef.current   = null;
            linkEditRef.current    = null;
            nodeEditRef.current    = null;
            olMap.removeLayer(selLayer);
            olMap.removeLayer(hoverLayer);
            olMap.removeLayer(editLayer);
            selSrcRef.current   = null;
            hoverSrcRef.current = null;
            editSrcRef.current  = null;
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
            hoveredLinkIdRef.current, hoveredNodeIdRef.current);

        if (selectedLinkId !== null) {
            const link = network.links.find(l => String(l.id) === String(selectedLinkId));
            if (link) linkEditRef.current = buildLinkEditFeatures(editSrc, link.coordinates);
        } else if (selectedNodeId !== null) {
            const node = network.nodes.find(n => String(n.id) === String(selectedNodeId));
            if (node) nodeEditRef.current = buildNodeEditFeatures(editSrc, node);
        } else {
            editSrc.clear();
        }
    }, [selectedLinkId, selectedNodeId]);

    // ── OL 포인터 이벤트 (선택 + 드래그 편집) ───────────────────
    useEffect(() => {
        if (!olMap || !isSelectActive) return;
        const vp = olMap.getViewport();

        const blockContextMenu = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
        vp.addEventListener('contextmenu', blockContextMenu, true);

        // ──────────────────── pointerdown ──────────────────────
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const coord = olMap.getEventCoordinate(e);
            const res   = olMap.getView().getResolution() ?? 1;
            const HANDLE_THRESH = res * 18;
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
                        e.stopPropagation();
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
                        e.stopPropagation();
                        olMap.getTargetElement().style.cursor = 'grabbing';
                        return;
                    }
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

            // 드래그 중
            if (drag) {
                e.stopPropagation();
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

            // 드래그 아닌 hover — 핸들 위 커서 변경
            const { selectedLinkId: sl, selectedNodeId: sn } = useNetworkDrawStore.getState();

            if (sl !== null && linkEditRef.current && network) {
                const link = network.links.find(l => String(l.id) === String(sl));
                if (link) {
                    const HANDLE_THRESH = res * 18;
                    const onHandle = link.coordinates.some(
                        c => olDist(fromLonLat([c.lng, c.lat]), coord) < HANDLE_THRESH
                    );
                    olMap.getTargetElement().style.cursor = onHandle ? 'grab' : 'default';
                    return;
                }
            }
            if (sn !== null && nodeEditRef.current && network) {
                const node = network.nodes.find(n => String(n.id) === String(sn));
                if (node) {
                    const HANDLE_THRESH = res * 18;
                    const onHandle = olDist(fromLonLat([node.coordinates.lng, node.coordinates.lat]), coord) < HANDLE_THRESH;
                    olMap.getTargetElement().style.cursor = onHandle ? 'grab' : 'default';
                    return;
                }
            }

            // 아무것도 선택 안됐을 때 hover highlight
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
            const drag = dragStateRef.current;
            if (!drag) return;

            dragStateRef.current = null;
            olMap.getTargetElement().style.cursor = 'default';
            e.stopPropagation();

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

            const node = findNearestNode(network.nodes, coord, res * 20);
            if (node) { useNetworkDrawStore.getState().setSelectedNode(node.id); return; }
            const link = findNearestLink(network.links, coord, res * 15);
            if (link) { useNetworkDrawStore.getState().setSelectedLink(link.id); return; }
            useNetworkDrawStore.getState().clearSelection();
        };
        vp.addEventListener('click', onClick, true);

        // ──────────────────── 키보드 ──────────────────────────
        const onKey = (e: KeyboardEvent) => {
            const { selectedLinkId: sl, selectedNodeId: sn } = useNetworkDrawStore.getState();
            if (e.key === 'Escape') {
                useNetworkDrawStore.getState().clearSelection();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                if (sl !== null) {
                    applyNetworkUpdate(deleteLinkFromNetwork(network, sl));
                    useNetworkDrawStore.getState().clearSelection();
                    useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${sl} 삭제됨` });
                } else if (sn !== null) {
                    const node = network.nodes.find(n => String(n.id) === String(sn));
                    applyNetworkUpdate(deleteNodeFromNetwork(network, sn));
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

    // ── Cesium 클릭 선택 ────────────────────────────────────────
    useEffect(() => {
        if (!isSelectActive || !viewer) return;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const scene = viewer.scene;
            const node = findNearestNodeCesium(network.nodes, e.position, scene, 25);
            if (node) { useNetworkDrawStore.getState().setSelectedNode(node.id); return; }
            const link = findNearestLinkCesium(network.links, e.position, scene, 15);
            if (link) { useNetworkDrawStore.getState().setSelectedLink(link.id); return; }
            useNetworkDrawStore.getState().clearSelection();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        return () => { handler.destroy(); };
    }, [isSelectActive, viewer]);
};

// ══════════════════════════════════════════════════════════════════
// 공통 업데이트
// ══════════════════════════════════════════════════════════════════
export function applyNetworkUpdate(network: Network) {
    assignPropertyToResponseData(network as any);
    useNetworkStore.getState().setCurrentJsonData(network);
    useNetworkStore.getState().setChange(true);
}
