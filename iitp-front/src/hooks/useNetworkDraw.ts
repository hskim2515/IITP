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
import { useNetworkUndoStore } from '@stores/useNetworkUndoStore';
import { useEditGuideStore } from '@stores/useEditGuideStore';
import { useNetworkEditStore } from '@stores/useNetworkEditStore';
import { applyNetworkUpdate, deleteLinkFromNetwork, markRemovedForTileMask, mergeNodesInNetwork, projectOnSegments, reconcileSignalConnectionIds, selectNodeAndShowToolbar } from '@hooks/useNetworkSelect';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import { useMapStore } from '@stores/useMapStore';
import { useMessageStore } from '@stores/useMessageStore';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
import { generateGUID, assignPropertyToResponseData } from '@utils/guid';
import { normalizeTurning } from '@utils/turning';
import { Network, Node, Link, Lane, Cell, Segment, Port, Connection, Coordinates } from '@type/Network';
import { UpdateLogEntry } from '@type/HistoryTypes';
import { LAYER_CONFIG } from '@component/tool/DataIOPanel';

/** 신규 추가 객체의 모든 필드를 added 항목으로 수집 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** 도로 그리기 상시 가이드 — 단계(시작점 대기/구간 추가)에 맞춰 갱신 */
function setDrawGuide(stage: 'start' | 'segment'): void {
    useEditGuideStore.getState().setGuide(stage === 'start' ? {
        title: '도로 그리기',
        steps: [
            { keys: ['클릭'], text: '시작점을 클릭하세요 — 기존 노드·링크 위를 클릭하면 자동으로 이어집니다', em: true },
            { keys: ['1', '~', '8'], text: '차선 수 즉시 지정' },
            { keys: ['우클릭'], text: '그리기 종료' },
        ],
        tip: '노드·링크 근처는 자동으로 달라붙습니다(스냅). Alt를 누르고 있으면 노드·링크 스냅은 꺼지고, 대신 각도(정렬) 스냅이 켜져요.',
    } : {
        title: '도로 그리기 — 구간 추가 중',
        steps: [
            { keys: ['클릭'], text: '끝점을 클릭하면 도로가 만들어지고, 그 지점에서 이어서 계속 그립니다', em: true },
            { keys: ['더블클릭'], text: '이어 그리기 끝내기 (새 시작점 선택으로 돌아감)' },
            { keys: ['1', '~', '8'], text: '다음 구간 차선 수 즉시 지정' },
            { keys: ['[', ']'], text: '차선 수 1개씩 증감' },
            { keys: ['Shift'], text: '15° 단위 각도 잠금' },
            { keys: ['Alt'], text: '노드·링크 스냅 해제 + 각도(정렬) 스냅 켜기' },
            { keys: ['우클릭'], text: '지금 그리던 구간 취소' },
        ],
        tip: '기존 링크 위에서 끝내면 그 링크를 잘라서 자동으로 연결합니다.',
    });
}

function collectAdded(item: any): NonNullable<UpdateLogEntry['added']> {
    if (!item?.__guid) return [];
    return Object.entries(item as Record<string, unknown>).map(([field, value]) => ({
        guid: item.__guid as string, field, oldValue: null, newValue: value,
    }));
}

// ⚠️ 실측(2026-07-30): 노드에서 48.64m 떨어진 클릭이 스냅 실패 → 노드 연결 안 되고 옆에
// 새 노드가 따로 생기는 문제로 재현됨. 원래 25m는 화면상 "가까이 클릭했다"고 느껴지는
// 거리보다 훨씬 좁았다 — res(해상도) 기반 보정만으로는 중간 줌 레벨에서 여전히 25m 근처에
// 머물러 부족했으므로, 기준값 자체를 이 실측 사례를 여유 있게 덮는 값으로 올린다.
const SNAP_RADIUS_M = 60;
const TAGGED_SNAP_RADIUS_M = 96; // "교차로로 지정"된 노드는 놓치지 않도록 SNAP_RADIUS_M의 1.6배
const SNAP_LINK_RADIUS_M = 35;   // 링크 위 스냅 임계값 (m) — 위와 동일한 이유로 상향
// 그래도 화면을 아주 많이 축소하면 고정 반경도 화면상 좁은 과녁이 될 수 있으므로, 현재
// 해상도(res, m/px) 기준 최소 픽셀 크기와 고정 반경 중 큰 값을 쓴다(둘 다 방어).
const SNAP_PIXEL_TARGET = 20;
// 스냅(SNAP_RADIUS_M)은 "가까우면 연결 의도로 봐준다"는 관대한 UX용 반경이지만, 이건
// 그것과 별개로 "결과적으로 거의 같은 지점에 생긴 두 노드"를 잡는 훨씬 좁은 안전망이다.
// 방향(진행 방향/링크 순서)이 달라도 위치가 사실상 같으면 중복으로 본다. 과거 "50m 이내
// 자동 병합"은 조밀한 도심에서 서로 다른 두 교차로를 잘못 합쳐 폐지됐지만(아래 finishSegment
// 주석 참고), 이 반경은 그보다 훨씬 좁아 실제로 겹치다시피 한 경우만 잡으므로 그 위험이 없다.
const DUPLICATE_NODE_RADIUS_M = 3;
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

// ── 교차로로 지정된 노드 마커 (항상 표시, 커서 근접 여부 무관) ────────
// 지금 화면에 로드돼있으면(currentJsonData 에 노드가 존재) 금색 별 — 여기 스냅하면
// 실제로 이 노드에 연결된다. 로드 안 돼있으면(타일 evict) 경고 스타일로 구분해,
// "여기 그려도 지금은 진짜 이 노드에 안 붙는다"는 걸 사용자가 알 수 있게 한다.
function taggedNodeStyle(loaded: boolean): Style {
    const color = loaded ? 'rgba(255,215,0,1)' : 'rgba(255,120,60,0.9)';
    return new Style({
        image: new RegularShape({
            points: 5,
            radius: 10,
            radius2: 4,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: '#fff', width: 1.2 }),
        }),
        text: loaded ? undefined : new OlText({
            text: '⚠ 로드 안 됨 — 이 지역을 한 번 더 방문하세요',
            font: '10px sans-serif',
            fill: new Fill({ color: 'rgba(255,120,60,1)' }),
            stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 2 }),
            offsetY: -14,
        }),
    });
}

// ── CAD 가이드 스타일 ──────────────────────────────────────────
// 노드 정렬 레이: 기존 링크 방향의 확장선 (비활성)
const alignRayStyle = new Style({
    stroke: new Stroke({ color: 'rgba(0, 220, 255, 0.30)', width: 1, lineDash: [4, 7] }),
});
// 정렬 스냅 활성: 커서가 연장선 위에 있을 때
const alignSnapActiveRayStyle = new Style({
    stroke: new Stroke({ color: 'rgba(50, 255, 180, 0.85)', width: 1.8, lineDash: [6, 4] }),
});
const alignSnapStyle = [
    new Style({ image: new CircleStyle({ radius: 16, fill: new Fill({ color: 'rgba(50,255,180,0.08)' }), stroke: new Stroke({ color: 'rgba(50,255,180,0.4)', width: 1 }) }) }),
    new Style({ image: new CircleStyle({ radius: 9,  fill: new Fill({ color: 'rgba(50,255,180,0.9)' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }),
];
// Shift 각도 고정 가이드 라인
const angleLockStyle = new Style({
    stroke: new Stroke({ color: 'rgba(255, 220, 0, 0.70)', width: 1.2, lineDash: [8, 5] }),
});

const ALIGN_SNAP_MIN_M  = 10;   // 이 거리 이내는 노드 스냅에 맡김
const ALIGN_SNAP_MAX_M  = 150;  // 이 거리 이상 노드의 연장선은 무시(과도 스냅 방지, 기존 400 너무 멂)
const ALIGN_ANGLE_DEG   = 5;    // 연장선 방향과 ±5° 이내면 스냅(기존 8° 완화)
const ALIGN_PERP_MAX_M  = 12;   // 커서~연장선 수직거리 상한(m). 각도만으론 먼 곳서 크게 벗어나도 잡혀 이상하게 스냅됨

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

/** taggedIds 에 속한 노드는 SNAP_RADIUS_M 대신 TAGGED_SNAP_RADIUS_M(더 넓음)을 적용 —
 *  "교차로로 지정"한 노드를 화면 이동 후에도 놓치지 않고 정확히 그 id로 스냅하기 위함
 *  (여전히 실제 노드 객체만 반환하므로 서로 다른 노드가 잘못 합쳐질 여지는 없음). */
function findSnapNode(nodes: Node[], lonLat: number[], taggedIds?: Set<string>, baseRadiusM: number = SNAP_RADIUS_M): Node | null {
    let best: Node | null = null;
    let bestDist = Infinity;
    // TAGGED 쪽도 base 대비 원래 비율(40/25)을 유지 — base가 res로 늘어나면 tagged도 같이 늘어남
    const taggedRadiusM = baseRadiusM * (TAGGED_SNAP_RADIUS_M / SNAP_RADIUS_M);
    for (const n of nodes) {
        const radius = taggedIds?.has(String(n.id)) ? taggedRadiusM : baseRadiusM;
        const d = getDistance([n.coordinates.lng, n.coordinates.lat], [lonLat[0], lonLat[1]]);
        if (d < radius && d < bestDist) { bestDist = d; best = n; }
    }
    return best;
}

// ── 링크 위 최근접점 스냅 ────────────────────────────────────────
type LinkSnap = { link: Link; coord: Coordinate; wgs84: Coordinates; segIdx: number };

function findSnapLink(links: Link[], cursor: Coordinate, nodeSnapped: boolean, baseRadiusM: number = SNAP_LINK_RADIUS_M): LinkSnap | null {
    if (nodeSnapped) return null; // 노드 스냅 우선
    let best: LinkSnap | null = null;
    let bestDist = baseRadiusM;

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
                best = { link, coord: [px, py], wgs84: { lng: ll[0]!, lat: ll[1]! }, segIdx: si };
            }
        }
    }
    return best;
}

// ── 도로 연장선 방향 스냅 (CAD Alignment Snap) ───────────────────
type AlignmentSnap = {
    nodeOl: Coordinate;     // 기준 노드 OL 좌표
    angle: number;          // 스냅 방향 (radians, OL 좌표계)
    coord: Coordinate;      // 스냅된 커서 OL 좌표
    bearingDeg: number;     // WGS84 방위각 (표시용)
};

function getAlignRayAngles(node: Node, links: Link[]): Array<{ angle: number; nodeOl: Coordinate; bearingDeg: number }> {
    const nodeOl = fromLonLat([node.coordinates.lng, node.coordinates.lat]);
    const result: Array<{ angle: number; nodeOl: Coordinate; bearingDeg: number }> = [];
    for (const link of links) {
        const isFrom = String(link.fromNode) === String(node.id);
        const isTo   = String(link.toNode)   === String(node.id);
        if (!isFrom && !isTo) continue;
        const c = link.coordinates;
        // 가장 가까운 이웃 점 → 연장선 방향 계산
        const otherWgs84 = isFrom ? c[1] ?? c[0]! : c[c.length - 2] ?? c[0]!;
        const otherOl = fromLonLat([otherWgs84.lng, otherWgs84.lat]);
        const dx = otherOl[0]! - nodeOl[0]!, dy = otherOl[1]! - nodeOl[1]!;
        const baseAngle = Math.atan2(dy, dx);
        // 연장선: 기존 방향(연장) + 역방향(역연장) 두 가지
        for (const a of [baseAngle, baseAngle + Math.PI]) {
            // WGS84 방위각 계산 (표시용)
            const extLl = toLonLat([nodeOl[0]! + Math.cos(a) * 100, nodeOl[1]! + Math.sin(a) * 100]);
            const dLon = (extLl[0]! - node.coordinates.lng) * Math.PI / 180;
            const lat1r = node.coordinates.lat * Math.PI / 180;
            const lat2r = extLl[1]! * Math.PI / 180;
            const bearing = Math.round(
                ((Math.atan2(Math.sin(dLon) * Math.cos(lat2r),
                    Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon))
                * 180 / Math.PI) + 360) % 360
            );
            result.push({ angle: a, nodeOl, bearingDeg: bearing });
        }
    }
    return result;
}

function findAlignmentSnap(
    nodes: Node[], links: Link[], cursor: Coordinate, cursorLonLat: number[],
): AlignmentSnap | null {
    const THRESH = ALIGN_ANGLE_DEG * Math.PI / 180;
    let best: AlignmentSnap | null = null;
    let minDiff = THRESH;

    for (const node of nodes) {
        const distM = getDistance([node.coordinates.lng, node.coordinates.lat], cursorLonLat);
        if (distM < ALIGN_SNAP_MIN_M || distM > ALIGN_SNAP_MAX_M) continue;

        const nodeOl = fromLonLat([node.coordinates.lng, node.coordinates.lat]);
        const toCursorAngle = Math.atan2(cursor[1]! - nodeOl[1]!, cursor[0]! - nodeOl[0]!);
        const distOl = Math.hypot(cursor[0]! - nodeOl[0]!, cursor[1]! - nodeOl[1]!);

        for (const ray of getAlignRayAngles(node, links)) {
            let diff = Math.abs(toCursorAngle - ray.angle);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            // 수직거리 상한: 각도가 맞아도 커서가 연장선에서 실제로 멀면(distM·sin(diff)) 스냅 안 함.
            //   (각도만 판정하면 먼 노드일수록 큰 이탈도 통과해 "이상한 곳" 스냅 발생)
            if (distM * Math.sin(diff) > ALIGN_PERP_MAX_M) continue;
            if (diff < minDiff) {
                minDiff = diff;
                best = {
                    nodeOl,
                    angle: ray.angle,
                    coord: [nodeOl[0]! + distOl * Math.cos(ray.angle), nodeOl[1]! + distOl * Math.sin(ray.angle)],
                    bearingDeg: ray.bearingDeg,
                };
            }
        }
    }
    return best;
}

// ── 교차 노드 커넥션 자동 재생성 ────────────────────────────────
// 노드의 모든 in-link / out-link 조합으로 S/L/R 커넥션을 새로 계산
// 반환값: 재생성으로 무효해진 connectionId를 참조하던 신호 개수(참조 초기화됨) — 호출부에서 안내용.
export function createIntersectionAtNode(nodeId: number | string): number {
    const network = useNetworkStore.getState().currentJsonData;
    if (!network) return 0;
    useNetworkUndoStore.getState().push(network);
    const updated = regenerateNodeConnections(network, nodeId);
    assignPropertyToResponseData(updated as any);
    useNetworkStore.getState().setCurrentJsonData(updated);
    useNetworkStore.getState().setChange(true);
    return reconcileSignalConnectionIds(updated, [nodeId]);
}

/** 노드의 커넥션을 in/out 링크 조합으로 전면 재생성 (링크 반전·병합 후 정합성 복구용) */
export function regenerateNodeConnections(network: Network, nodeId: number | string): Network {
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
    // conn.coordinates는 stale이 될 수 있으므로 초기화 (렌더러가 laneMap에서 재계산)
    const mergedPorts = [...keepNode.ports, ...removeNode.ports];
    const mergedConns = [...keepNode.connections, ...removeNode.connections]
        .map((c: any) => ({ ...c, coordinates: [] }));

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
/**
 * 링크를 지정 좌표에서 분할 — 새 노드 + 통과 커넥션 자동 생성, 양끝 노드 포트/커넥션 재연결.
 *
 * @param segIdx 분할 지점이 원래 링크의 몇 번째 세그먼트(coordinates[segIdx]~[segIdx+1]) 위에
 *   있는지(예: useNetworkSelect.ts의 projectOnSegments가 반환하는 segIdx). 주어지면 분할
 *   지점 앞/뒤의 원래 꺾인 정점을 그대로 보존한다(곡선 도로가 3점 이상이면 중요 — 안 그러면
 *   fromCoord/toCoord만 남기고 중간 정점이 통째로 사라져 직선으로 뭉개진다, 즉 실제로는
 *   존재하는 굽은 구간을 건너뛰는 엉뚱한 직선이 그려짐). 생략하면(기존 호출부 호환) 예전과
 *   동일하게 양끝 2점만으로 처리 — 클릭 시점에 세그먼트 인덱스를 모르는 호출부를 위한 폴백.
 *   ⚠️ 2026-07-29 실사용 피드백("연결된 링크 시작 위치가 노드와 무관한 엉뚱한 지점") 원인 —
 *   connectNodeToLinks가 도입되며 곡선 링크 중간 지점에서 분할하는 경우가 처음 생겨 드러남.
 */
export function splitLinkInNetwork(
    network: Network,
    link: Link,
    splitCoord: Coordinates,
    ts: number,
    segIdx?: number,
): { updatedNetwork: Network; newNodeId: number | string } {
    const l1Id = ts + 10;
    const l2Id = ts + 11;
    const mId  = ts + 12;

    const fromCoord = link.coordinates[0]!;
    const toCoord   = link.coordinates[link.coordinates.length - 1]!;

    const coords1 = segIdx != null ? [...link.coordinates.slice(0, segIdx + 1), splitCoord] : [fromCoord, splitCoord];
    const coords2 = segIdx != null ? [splitCoord, ...link.coordinates.slice(segIdx + 1)] : [splitCoord, toCoord];

    // L1: 기존 fromNode → 새 노드 M
    const linkL1 = makeLinkFromCoords(l1Id, link.fromNode, mId, coords1,
        link.numLane, link.width, link.maxSpd);
    // L2: 새 노드 M → 기존 toNode
    const linkL2 = makeLinkFromCoords(l2Id, mId, link.toNode, coords2,
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
                connections: n.connections.map((c: any) =>
                    String(c.toLink) === String(link.id) ? { ...c, toLink: l1Id, coordinates: [] } : c),
            };
        }
        if (String(n.id) === String(link.toNode)) {
            return {
                ...n,
                ports: n.ports.map(p =>
                    String(p.linkId) === String(link.id) && p.type === 'in' ? { ...p, linkId: l2Id } : p),
                connections: n.connections.map((c: any) =>
                    String(c.fromLink) === String(link.id) ? { ...c, fromLink: l2Id, coordinates: [] } : c),
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

/** 포트·커넥션 없는 고립 노드 하나를 추가한다 — Alt+빈 지형 클릭(useNetworkSelect.ts
 *  placeNodeAt)으로 "도로는 안 그리고 노드만" 놓을 때 쓴다. 어떤 도로에 연결할지는 자동
 *  추측하지 않고, 이후 사용자가 노드 컨텍스트 툴바의 "🔗 링크 연결"로 명시적으로 고른다
 *  (connectNodeToLinks 참고). 그때까지는 나중에 도로 그리기로 수동 연결하거나 "커넥션 편집"
 *  으로 다룰 수 있게 노드만 우선 놓아둔 상태다. */
export function createStandaloneNodeInNetwork(network: Network, coord: Coordinates, id: number | string): Network {
    return { ...network, nodes: [...network.nodes, makeNode(id, coord, [])] };
}

/**
 * 노드 하나를 사용자가 명시적으로 고른 링크들에 연결한다 — NetworkEditToolbar의
 * "🔗 링크 연결" 흐름(connectTargetNodeId + Shift+클릭 멀티셀렉트) 전용. 자동으로 "가장
 * 가까운 도로"를 추측해 스냅하던 이전 방식은 실사용 피드백으로 폐기 — 사용자가 노드/링크를
 * 선택하는 모드로 직접 고른 것만 연결한다.
 *
 * 선택된 링크마다: 그 노드 좌표에 가장 가까운 지점에서 링크를 분할(splitLinkInNetwork)한 뒤,
 * 새로 생긴 분할 노드를 대상 노드(targetNodeId)에 병합(mergeNodesInNetwork)한다 — 이렇게
 * 하면 여러 링크를 골라도 전부 같은 하나의 노드로 모이고(다중 접근로 교차로), 대상 노드
 * 자체의 좌표는 그대로 유지된다(mergeNodesInNetwork는 keep 쪽 좌표를 보존하고 링크
 * 끝점만 그 위치로 당겨 붙인다).
 *
 * ⚠️ 2026-07-29: 예전엔 여기서 마지막에 regenerateNodeConnections로 모든 in/out 포트
 * 조합에 S/L/R을 한꺼번에 자동 생성했으나, 실사용 피드백으로 제거 — 도로를 물리적으로
 * 잇는 것(분할·병합)까지는 필요해도 회전 커넥션 자체는 사용자가 레인 단위로 직접 골라야
 * 한다는 요청. 그래서 이 함수는 포트만 만들고 커넥션은 비운 채 반환한다 — 호출부가 곧바로
 * 기존 수동 커넥션 편집(activateConnectionAndReset, in-레인→out-레인 클릭 흐름)으로 넘긴다.
 */
export function connectNodeToLinks(
    network: Network,
    targetNodeId: number | string,
    linkIds: (number | string)[],
    tsBase: number,
): Network {
    let net = network;
    let ts = tsBase;
    for (const linkId of linkIds) {
        const link = net.links.find(l => String(l.id) === String(linkId));
        const targetNode = net.nodes.find(n => String(n.id) === String(targetNodeId));
        if (!link || !targetNode) continue;

        const targetOl = fromLonLat([targetNode.coordinates.lng, targetNode.coordinates.lat]);
        const proj = projectOnSegments(link.coordinates, targetOl, Infinity);
        const splitCoord = proj ? (() => {
            const ll = toLonLat(proj.point);
            return { lng: ll[0]!, lat: ll[1]! };
        })() : targetNode.coordinates;

        // segIdx를 함께 넘겨 분할 지점 앞/뒤의 원래 굴곡 정점을 보존한다 — 안 그러면(곡선
        // 링크의 중간 세그먼트에서 분할될 때) fromCoord/toCoord 2점만 남아 중간 굴곡이
        // 사라진 직선이 생긴다(2026-07-29 실사용 피드백: "연결된 링크가 노드와 무관한
        // 엉뚱한 지점에서 시작함"의 원인 — splitLinkInNetwork 주석 참고).
        // splitLinkInNetwork는 ts+10/+11/+12를 새 id로 쓰므로, 반복 호출 시 ts를 100씩
        // 띄워야 이전 반복에서 만든 id와 겹치지 않는다(+1씩만 늘리면 즉시 충돌).
        const { updatedNetwork, newNodeId: splitNodeId } = splitLinkInNetwork(net, link, splitCoord, ts, proj?.segIdx);
        ts += 100;
        net = mergeNodesInNetwork(updatedNetwork, targetNodeId, splitNodeId);
    }
    // ⚠️ 2026-07-29 실사용 피드백: 도로를 물리적으로 잘라 붙이는 것(위 split+merge)까지는
    // 필요하지만, 그 직후 모든 in/out 조합에 S/L/R을 한꺼번에 자동 생성(regenerateNodeConnections)
    // 하는 건 원치 않음 — "레인별로 직접 찍어서" 만들고 싶다는 요청. 그래서 여기서는 포트만
    // 만든 채 커넥션은 비워두고 반환한다 — 호출부(NetworkEditToolbar handleConnectToTarget)가
    // 곧바로 "🔀 커넥션 편집"(activateConnectionAndReset)으로 넘겨서, 기존에 이미 있던
    // in-레인 클릭 → out-레인 클릭 → 커넥션 1개 생성 흐름으로 사용자가 직접 만들게 한다.

    // 연결 결과 교차로(3방향 이상)가 됐으면 이 노드에 붙은 모든 링크를 setback — 그리기
    // (finishSegment) 경로와 형상 규칙을 일치시킨다(2026-07-30 사용자 확정). 이미 후퇴돼
    // 있는 링크(KTDB 등)는 setbackNewLinks 내부의 근접 가드가 걸러 이중 후퇴하지 않는다.
    // 기존 도로가 바뀌는 데 대한 confirm은 호출부(handleConnectToTarget)에서 실행 전에 받는다.
    const targetNode = net.nodes.find(n => String(n.id) === String(targetNodeId));
    if (targetNode) {
        const degree = new Set(targetNode.ports.map(p => String(p.linkId))).size;
        if (degree >= JUNCTION_MIN_DEGREE) {
            const entries: Array<{ linkId: number | string; nodeEnd: 'start' | 'end'; nodeId: number | string }> = [];
            for (const p of targetNode.ports) {
                const l = net.links.find(ll => String(ll.id) === String(p.linkId));
                if (!l) continue;
                entries.push({
                    linkId: l.id,
                    nodeEnd: String(l.fromNode) === String(targetNodeId) ? 'start' : 'end',
                    nodeId: targetNodeId,
                });
            }
            net = setbackNewLinks(net, entries);
        }
    }
    return net;
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
/** 커넥션 표시용 곡선 (NetworkFeatureLayer.generateQuadraticBezierCurve 와 동일 규약).
 *  편집 화면이 [from → 노드중심 → to] 3점 꺾은선으로 그려 실제 렌더(베지어 곡선)와
 *  달라 보이던 것("커넥션이 각지게 만들어짐") 통일. Straight 는 렌더와 동일하게 직선. */
function connCurveOl(fromOl: Coordinate, nodeOl: Coordinate, toOl: Coordinate, turning?: string): Coordinate[] {
    if (normalizeTurning(turning) === 'Straight') return [fromOl, toOl];
    const baseX = (fromOl[0]! + toOl[0]!) / 2, baseY = (fromOl[1]! + toOl[1]!) / 2;
    const ctrlX = baseX + (nodeOl[0]! - baseX) * 0.4, ctrlY = baseY + (nodeOl[1]! - baseY) * 0.4;
    const pts: Coordinate[] = [];
    for (let i = 0; i <= 15; i++) {
        const t = i / 15, u = 1 - t;
        pts.push([
            u * u * fromOl[0]! + 2 * u * t * ctrlX + t * t * toOl[0]!,
            u * u * fromOl[1]! + 2 * u * t * ctrlY + t * t * toOl[1]!,
        ]);
    }
    return pts;
}

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
    // ⚠️ 실측 지적: 예전엔 length:0으로 고정 저장했다 — NextSim이 링크 셀 개수를
    // Math.max(1, Math.ceil(length/CELL_LENGTH))처럼 length로 나누는 계산을 어딘가에서
    // 한다면 0은 division-by-zero/0-size 배열 크래시로 이어질 수 있는 값이라(이 파일의
    // makeLink가 링크에는 이미 이 위험을 알고 Math.max(1,...)로 방어해둔 것과 대비됨),
    // 실제 커넥션 양끝 좌표 간 거리로 계산해 항상 양수 길이를 갖도록 한다.
    const connLength = getDistance([fromEnd.lng, fromEnd.lat], [toStart.lng, toStart.lat]);

    const conn = (fromLane: number, toLane: number, idx: number): Connection => ({
        featureType: 'connections' as any,
        id: existingCount + idx,
        fromLink: fromLink.id, fromLane,
        fromLaneCoordinates: fromEnd,
        toLink: toLink.id, toLane,
        toLaneCoordinates: toStart,
        turning,
        length: connLength,
        width: laneWidth,
        ffSpd,
        shape: '',
        coordinates: [],
    } as Connection);

    if (turning === 'Straight') {
        // 직진: 동일 인덱스 1:1 매핑 + 차선수가 다르면(확폭/축소) 남는 차선을 가장자리로 fan.
        // min() 매핑만 하면 확폭 구간의 늘어난 차선(또는 축소 전 초과 차선)이 커넥션 없이
        // 고립돼 시뮬레이션에서 절대 도달 불가능한 "죽은 차선"이 된다 (실사용 발견 —
        // 확폭 포켓 링크를 만들어도 새 차선에 아무도 못 들어감). 커넥션 편집 패널의
        // lanePairsFor 와 동일 규약으로 통일.
        const cnt = Math.min(fLanes, tLanes);
        const pairs: [number, number][] = [];
        for (let i = 0; i < cnt; i++) pairs.push([i, i]);
        for (let i = cnt; i < fLanes; i++) pairs.push([i, tLanes - 1]); // 남는 진입차선 → 마지막 진출차선 병합
        for (let i = cnt; i < tLanes; i++) pairs.push([fLanes - 1, i]); // 남는 진출차선(확폭) ← 마지막 진입차선에서 분기
        return pairs.map(([a, b], i) => conn(a, b, i));
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

/** makeLink의 다중 정점 버전 — splitLinkInNetwork가 곡선 링크(3점 이상)를 분할할 때, 분할
 *  지점 앞/뒤의 원래 꺾인 정점을 그대로 살려서 새 링크 2개를 만드는 데 쓴다(makeLink처럼
 *  양끝 2점만 남기면 중간 굴곡이 사라져 실제 도로와 무관한 직선이 생긴다). 렌더러
 *  (NetworkFeatureLayer.buildLinkFeatures)는 link.coordinates 전체를 따라 그리므로 이 배열이
 *  실제 시각적 모양을 결정한다 — lane.coordinates는 기존 관례대로 양끝 2점만 유지(렌더링에는
 *  안 쓰이고 mergeNodesInNetwork의 shiftEndpoint 등 형상 이동 계산에만 쓰임). */
function makeLinkFromCoords(
    id: number | string,
    fromNodeId: number | string,
    toNodeId: number | string,
    coords: Coordinates[],
    laneCount: number,
    linkWidth: number,
    maxSpd: number,
): Link {
    let length = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        length += getDistance([coords[i]!.lng, coords[i]!.lat], [coords[i + 1]!.lng, coords[i + 1]!.lat]);
    }
    const numCells = Math.max(1, Math.ceil(length / DEFAULT_CELL_LENGTH));
    const from = coords[0]!;
    const to   = coords[coords.length - 1]!;

    const lanes: Lane[] = Array.from({ length: laneCount }, (_, i) => {
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
        coordinates: coords, lanes,
    } as Link;
}

// ── 교차로 setback: 새로 그린 링크가 3방향 이상(실제 교차로)에 닿으면 그 끝을 약간
// 후퇴시켜 connection(회전 동선) 곡선이 그려질 공간을 만든다. KTDB 임포트 변환기
// (KtdbNetworkConverter)가 이미 하는 것과 같은 원리인데, 손으로 그린 링크는 노드
// 정중앙까지 그대로 이어져 있어 3방향 이상 모이는 교차로에서 connection이 겹쳐
// 보이거나 교차로 영역을 침범해 그려졌었다.
//
// ⚠️ 반드시 "방금 이 도구가 새로 만든 링크"만 대상으로 한다 — 기존(특히 KTDB 임포트로
// 들어와 타일 stripDetail로 lanes/cells가 비어있을 수 있는) 링크는 절대 건드리지 않는다.
// 새 링크는 이번에 makeLink로 막 만들어져 lanes/cells를 스스로 온전히 들고 있으므로
// coordinates/length/lanes를 자유롭게 고쳐도 다른 시스템(타일 stripDetail↔서버
// restoreStrippedDetail 매칭)과 충돌할 위험이 없다.
const JUNCTION_MIN_DEGREE       = 3;  // 이 이상 연결된 노드만 실제 교차로로 간주(통과점 제외)
const JUNCTION_SETBACK_MIN_M    = 8;
const JUNCTION_SETBACK_MAX_M    = 20; // 시가지 도로 규모 고려(KTDB 최대 35m는 간선 위주라 더 보수적으로)
const JUNCTION_SETBACK_MARGIN_M = 5;
const JUNCTION_SETBACK_MAX_FRAC = 0.35; // 짧은 링크 보호: 링크 길이의 35% 초과해서 자르지 않음
// 링크 끝점이 노드 중심에서 이 거리보다 멀리 있으면 "이미 후퇴된 형상"(KTDB 임포트 등)으로
// 보고 다시 자르지 않는다 — 교차로에 다리를 추가할 때마다 기존 링크가 반복해서 짧아지는
// 이중 후퇴 방지.
const JUNCTION_ALREADY_SETBACK_EPS_M = 2;

/** 이 노드에 링크 addedLinkCount개가 더 붙으면 교차로(JUNCTION_MIN_DEGREE 이상)가 되는지,
 *  그때 실제로 후퇴(setback)가 필요한 기존 flush 링크(끝점이 노드에 붙은 링크)가 몇 개인지
 *  미리 계산한다 — 호출부(그리기 finishSegment / "🔗 링크 연결" handleConnectToTarget)가
 *  기존 도로 형상을 바꾸기 전에 confirm을 띄울지 판단하는 공용 기준. 교차로가 안 되거나
 *  노드가 없으면 null. */
export function junctionFormationPreview(
    network: Network,
    nodeId: number | string,
    addedLinkCount: number,
): { afterDegree: number; flushCount: number } | null {
    const node = network.nodes.find(n => String(n.id) === String(nodeId));
    if (!node) return null;
    const beforeDegree = new Set(node.ports.map(p => String(p.linkId))).size;
    const afterDegree = beforeDegree + addedLinkCount;
    if (afterDegree < JUNCTION_MIN_DEGREE) return null;
    let flushCount = 0;
    for (const p of node.ports) {
        const l = network.links.find(ll => String(ll.id) === String(p.linkId));
        if (!l) continue;
        const eIdx = String(l.fromNode) === String(node.id) ? 0 : l.coordinates.length - 1;
        const ec = l.coordinates[eIdx]!;
        if (getDistance([ec.lng, ec.lat], [node.coordinates.lng, node.coordinates.lat]) <= JUNCTION_ALREADY_SETBACK_EPS_M) flushCount++;
    }
    return { afterDegree, flushCount };
}

/** 노드에 끝점이 붙어 있는(아직 후퇴 안 된) 링크 수 — "교차로 지정" 등에서 형상이 실제로
 *  바뀔지 미리 알려 confirm을 띄울지 판단하는 용도. */
export function countFlushLinksAtNode(network: Network, nodeId: number | string): number {
    const node = network.nodes.find(n => String(n.id) === String(nodeId));
    if (!node) return 0;
    let count = 0;
    for (const p of node.ports) {
        const l = network.links.find(ll => String(ll.id) === String(p.linkId));
        if (!l) continue;
        const eIdx = String(l.fromNode) === String(nodeId) ? 0 : l.coordinates.length - 1;
        const ec = l.coordinates[eIdx]!;
        if (getDistance([ec.lng, ec.lat], [node.coordinates.lng, node.coordinates.lat]) <= JUNCTION_ALREADY_SETBACK_EPS_M) count++;
    }
    return count;
}

/** "교차로로 지정" 시 — 현재 이 노드에 연결된 모든 링크를 즉시 후퇴(setback)시켜 미래
 *  교차로 형상을 선반영한다. 포트 수와 무관하게(2개 이하도) 적용 — "교차로로 간주된다면
 *  교차로로 취급"(2026-07-30 사용자 확정)의 지정 시점 버전. 이미 후퇴된 링크(KTDB 등)는
 *  setbackNewLinks 내부의 근접 가드가 걸러 이중 후퇴하지 않는다. */
export function setbackLinksAtNode(network: Network, nodeId: number | string): Network {
    const node = network.nodes.find(n => String(n.id) === String(nodeId));
    if (!node) return network;
    const entries: Array<{ linkId: number | string; nodeEnd: 'start' | 'end'; nodeId: number | string }> = [];
    for (const p of node.ports) {
        const l = network.links.find(ll => String(ll.id) === String(p.linkId));
        if (!l) continue;
        entries.push({
            linkId: l.id,
            nodeEnd: String(l.fromNode) === String(nodeId) ? 'start' : 'end',
            nodeId,
        });
    }
    return setbackNewLinks(network, entries, { ignoreDegree: true });
}

function junctionSetbackDistance(widths: number[]): number {
    const maxWidth = widths.reduce((m, w) => Math.max(m, w), 0);
    return Math.min(JUNCTION_SETBACK_MAX_M, Math.max(JUNCTION_SETBACK_MIN_M, maxWidth + JUNCTION_SETBACK_MARGIN_M));
}

/** coordsOl(OL 투영 좌표)의 start/end 쪽 끝을 setbackM만큼 안쪽으로 당긴 새 배열.
 *  트림 후 점이 2개 미만이 되면(링크가 너무 짧음) null. */
function trimCoordsOl(coordsOl: Coordinate[], end: 'start' | 'end', setbackM: number): Coordinate[] | null {
    if (coordsOl.length < 2) return null;
    const arr = coordsOl.map(c => [c[0]!, c[1]!] as Coordinate);
    let remaining = setbackM;
    if (end === 'end') {
        while (arr.length >= 2 && remaining > 0) {
            const last = arr[arr.length - 1]!, prev = arr[arr.length - 2]!;
            const segLen = Math.hypot(last[0]! - prev[0]!, last[1]! - prev[1]!);
            if (segLen < 1e-6) { arr.pop(); continue; }
            if (segLen <= remaining) { remaining -= segLen; arr.pop(); continue; }
            const frac = (segLen - remaining) / segLen;
            arr[arr.length - 1] = [prev[0]! + frac * (last[0]! - prev[0]!), prev[1]! + frac * (last[1]! - prev[1]!)];
            break;
        }
    } else {
        while (arr.length >= 2 && remaining > 0) {
            const first = arr[0]!, next = arr[1]!;
            const segLen = Math.hypot(next[0]! - first[0]!, next[1]! - first[1]!);
            if (segLen < 1e-6) { arr.shift(); continue; }
            if (segLen <= remaining) { remaining -= segLen; arr.shift(); continue; }
            const frac = remaining / segLen;
            arr[0] = [first[0]! + frac * (next[0]! - first[0]!), first[1]! + frac * (next[1]! - first[1]!)];
            break;
        }
    }
    return arr.length >= 2 ? arr : null;
}

/** entries에 나열된 (새로 만든) 링크들만, 그 링크가 닿는 노드가 이번 편집으로 3방향
 *  이상(실제 교차로)이 됐으면 그 쪽 끝을 setback만큼 후퇴시킨다. 그 외 링크는 전혀
 *  손대지 않는다 — node.ports는 이미 이번 편집이 반영된 network.nodes 기준이므로
 *  degree는 항상 "이 링크를 추가한 이후"의 최종 값이다. */
function setbackNewLinks(
    network: Network,
    entries: Array<{ linkId: number | string; nodeEnd: 'start' | 'end'; nodeId: number | string }>,
    opts?: { ignoreDegree?: boolean },
): Network {
    let links = network.links;
    let changed = false;

    for (const { linkId, nodeEnd, nodeId } of entries) {
        const node = network.nodes.find(n => String(n.id) === String(nodeId));
        if (!node) continue;
        const degree = new Set(node.ports.map((p: any) => String(p.linkId))).size;
        // ignoreDegree: "교차로로 지정"(미래 교차로 선언)처럼 아직 3방향이 안 됐어도
        // 형상을 선반영해야 하는 호출부용 — 그 외에는 실제 교차로(3방향+)만 후퇴.
        if (!opts?.ignoreDegree && degree < JUNCTION_MIN_DEGREE) continue;

        const linkIdx = links.findIndex(l => String(l.id) === String(linkId));
        if (linkIdx < 0) continue;
        const link = links[linkIdx]!;

        // 이미 후퇴된 형상(끝점이 노드 중심에서 EPS 이상 떨어져 있음 — KTDB 임포트, 또는
        // 과거 setback 처리된 링크)은 다시 자르지 않는다 — 이중 후퇴 방지.
        const endIdx = nodeEnd === 'start' ? 0 : link.coordinates.length - 1;
        const endCoord = link.coordinates[endIdx]!;
        const distToNode = getDistance(
            [endCoord.lng, endCoord.lat],
            [node.coordinates.lng, node.coordinates.lat],
        );
        if (distToNode > JUNCTION_ALREADY_SETBACK_EPS_M) continue;

        const touchingWidths = node.ports
            .map((p: any) => links.find(l => String(l.id) === String(p.linkId))?.width)
            .filter((w: any): w is number => typeof w === 'number');
        const setbackM = Math.min(
            junctionSetbackDistance(touchingWidths),
            link.length * JUNCTION_SETBACK_MAX_FRAC,
        );
        if (setbackM <= 0) continue;

        const coordsOl = link.coordinates.map(c => fromLonLat([c.lng, c.lat]));
        const trimmedOl = trimCoordsOl(coordsOl, nodeEnd, setbackM);
        if (!trimmedOl) continue;

        const trimmedWgs84 = trimmedOl.map(c => { const ll = toLonLat(c); return { lng: ll[0]!, lat: ll[1]! }; });
        let newLength = 0;
        for (let i = 0; i < trimmedOl.length - 1; i++) {
            newLength += Math.hypot(trimmedOl[i + 1]![0]! - trimmedOl[i]![0]!, trimmedOl[i + 1]![1]! - trimmedOl[i]![1]!);
        }
        const newNumCell = Math.max(1, Math.ceil(newLength / DEFAULT_CELL_LENGTH));
        const firstWgs = trimmedWgs84[0]!, lastWgs = trimmedWgs84[trimmedWgs84.length - 1]!;

        if (links === network.links) links = [...network.links]; // copy-on-write
        links[linkIdx] = {
            ...link,
            coordinates: trimmedWgs84,
            length: newLength,
            lanes: link.lanes.map(lane => {
                // 레인에 자체 다중 정점 형상이 있으면 링크와 같은 방식으로 끝만 잘라 형상을
                // 보존한다 — [first,last] 2점으로 덮어쓰면 기존(곡선) 링크의 레인이 직선으로
                // 뭉개진다. 형상이 없거나 2점뿐이면 종전처럼 링크 양끝으로 대체.
                let laneCoords: Coordinates[] = [firstWgs, lastWgs];
                if (lane.coordinates && lane.coordinates.length > 2) {
                    const laneOl = lane.coordinates.map((c: Coordinates) => fromLonLat([c.lng, c.lat]));
                    const laneTrimmed = trimCoordsOl(laneOl, nodeEnd, setbackM);
                    if (laneTrimmed) {
                        laneCoords = laneTrimmed.map(c => { const ll = toLonLat(c); return { lng: ll[0]!, lat: ll[1]! }; });
                    }
                }
                return {
                    ...lane,
                    coordinates: laneCoords,
                    numCell: newNumCell,
                    segments: lane.segments.map(seg => ({ ...seg, endPoint: newLength })),
                };
            }),
        };
        changed = true;
    }

    return changed ? { ...network, links } : network;
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

// 도로편집은 2D(OpenLayers)에서만. 편집모드에서 3D 영역은 로드뷰(참조)라 3D(Cesium) 드로우·
//   커넥션·노드 컨텍스트메뉴 등 편집 상호작용을 전부 비활성화한다.
const NETWORK_EDIT_2D_ONLY = true;

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
    // 시작점을 기존 링크 위에 클릭했을 때 — 그 자리에서 즉시 분할하지 않고, 어느 링크의
    // 어느 지점(+세그먼트, 곡선 보존용)인지만 기억해둔다. 실제 분할은 구간이 완성될 때
    // (finishSegment)만 일어난다 — 클릭만으로는 데이터를 전혀 바꾸지 않으므로, 그리다가
    // 취소해도 되돌릴 게 아예 없다(2026-07-30 사용자 결정: 즉시분할 폐지 — "그때만 분할이
    // 일어나면 되고 분할 버튼은 필요없다"; 이전엔 즉시 분할 후 취소 시 되돌리는 방식이었으나
    // 더블클릭으로 이어그리기를 끝내는 경로 등 되돌리기 호출이 누락된 경로가 계속 발견돼
    // 근본적으로 "애초에 완성 전엔 아무것도 안 바꾼다"로 단순화했다).
    const startLinkAnchorRef = useRef<{ linkId: number | string; segIdx: number } | null>(null);
    const shiftRef = useRef(false);  // Shift 키 각도 스냅 활성 여부
    const altRef = useRef(false);    // Alt 키: 스냅 임시 해제(노드/링크/정렬 스냅 무시)

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

    // ── Shift 각도 스냅: 15° 단위 + 근처 노드 정렬 방향 ──────────
    function applyAngleSnapOl(cursor: Coordinate, start: Coordinate): Coordinate {
        const dx = cursor[0]! - start[0]!;
        const dy = cursor[1]! - start[1]!;
        const angle = Math.atan2(dy, dx);
        const d = Math.hypot(dx, dy);

        // 후보 각도: 15° 격자
        const STEP = Math.PI / 12;
        const candidates: number[] = [Math.round(angle / STEP) * STEP];

        // 근처 노드의 정렬 방향도 후보에 추가
        const network = useNetworkStore.getState().currentJsonData;
        if (network) {
            const cursorLonLat = toLonLat(cursor);
            for (const node of network.nodes) {
                const distM = getDistance([node.coordinates.lng, node.coordinates.lat], cursorLonLat);
                if (distM < ALIGN_SNAP_MIN_M || distM > ALIGN_SNAP_MAX_M) continue;
                for (const ray of getAlignRayAngles(node, network.links)) {
                    candidates.push(ray.angle);
                }
            }
        }

        // 현재 각도와 가장 가까운 후보 선택
        let bestAngle = candidates[0]!;
        let minDiff = Infinity;
        for (const c of candidates) {
            let diff = Math.abs(angle - c);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            if (diff < minDiff) { minDiff = diff; bestAngle = c; }
        }

        return [start[0]! + d * Math.cos(bestAngle), start[1]! + d * Math.sin(bestAngle)];
    }

    // ── 그리기/커넥션 모드 중 Cesium 기본 이벤트 차단 ──────────
    useEffect(() => {
        if (NETWORK_EDIT_2D_ONLY) return; // 2D 전용: 3D 이벤트 차단 불필요
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
                const v = useCesiumStore.getState().viewer;
                updateCesiumPreview(
                    cesiumDsRef.current,
                    lastCesiumWgs84Ref.current,
                    snapNodeRef.current,
                    linkSnapRef.current,
                    startWgs84Ref.current,
                    linkWidthRef.current,
                    shiftRef.current,
                    v ?? undefined,
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
                selectNodeAndShowToolbar(node, { x: e.clientX, y: e.clientY });
            }
        };
        viewport.addEventListener('contextmenu', onContextMenuAlways);
        return () => viewport.removeEventListener('contextmenu', onContextMenuAlways);
    }, [olMap]);

    // ── 항상 활성: Alt+빈 지형 클릭으로 놓은 고립 노드 실제 배치 ─────────
    // useNetworkSelect.ts의 클릭 핸들러가 좌표를 pendingNodePlacement에 담아둔다 — 여기서는
    // 그 결정을 실행만 한다(beginDrawAt/pendingStartCoord와 동일한 "판단은 select, 실행은
    // draw" 분업). isActive 여부와 무관하게 항상 구독 — 이 배치 자체는 그리기 모드로 전환하지
    // 않는다(선택 모드 유지). 어떤 도로에 연결할지는 자동 추측하지 않음 — 노드 컨텍스트
    // 툴바의 "🔗 링크 연결"로 나중에 명시적으로 고른다(connectNodeToLinks).
    const pendingNodePlacement = useNetworkDrawStore((s) => s.pendingNodePlacement);
    useEffect(() => {
        if (!pendingNodePlacement) return;
        const { coord, screenPos } = pendingNodePlacement;
        useNetworkDrawStore.getState().clearPendingNodePlacement();

        const network = useNetworkStore.getState().currentJsonData;
        if (!network) return;
        const newNodeId = Date.now();

        const updatedNetwork = createStandaloneNodeInNetwork(network, coord, newNodeId);
        applyNetworkUpdate(updatedNetwork);
        useNetworkDrawStore.getState().setSelectedNode(newNodeId);
        useNetworkToolbarStore.getState().show(screenPos, 'node', { nodeId: String(newNodeId) });
        useMessageStore.getState().setMessage({ type: 'info', text: '노드를 추가했습니다 — 도로에 연결하려면 "🔗 링크 연결"을 누르세요' });
    }, [pendingNodePlacement]);

    // ── 항상 활성: 레인/링크 위 Alt+클릭으로 요청한 분할 실제 실행 ─────────
    // useNetworkSelect.ts의 클릭 핸들러가 분할 지점을 pendingLaneSplit에 담아둔다 — 여기서는
    // splitLinkInNetwork로 실제 링크를 끊고 통과 커넥션이 자동 생성된 새 노드를 만든다
    // (NetworkEditToolbar "✂ 분할" 버튼과 동일 로직, 한 번의 Alt+클릭으로 재클릭 없이 수행).
    const pendingLaneSplit = useNetworkDrawStore((s) => s.pendingLaneSplit);
    useEffect(() => {
        if (!pendingLaneSplit) return;
        const { linkId, splitCoord, segIdx, screenPos } = pendingLaneSplit;
        useNetworkDrawStore.getState().clearPendingLaneSplit();

        const network = useNetworkStore.getState().currentJsonData;
        if (!network) return;
        const link = network.links.find((l) => String(l.id) === linkId);
        if (!link) return;

        const { updatedNetwork, newNodeId } = splitLinkInNetwork(network, link, splitCoord, Date.now(), segIdx);
        applyNetworkUpdate(updatedNetwork);
        useNetworkEditStore.getState().addDeleted([linkId]);
        useNetworkDrawStore.getState().setSelectedNode(newNodeId);
        useNetworkToolbarStore.getState().show(screenPos, 'node', { nodeId: String(newNodeId) });
        useMessageStore.getState().setMessage({ type: 'info', text: `레인 위에 노드를 추가했습니다 — 새 노드 ${String(newNodeId)} (통과 커넥션 자동 생성)` });
    }, [pendingLaneSplit]);

    // ── Cesium 우클릭 → 노드 컨텍스트 메뉴 (2D 전용 모드에선 비활성) ────────────
    useEffect(() => {
        if (NETWORK_EDIT_2D_ONLY) return; // 편집은 2D 전용 → 3D 노드 컨텍스트메뉴 없음
        if (!viewer) return;
        const canvas = viewer.canvas;
        const onCesiumContextMenu = (e: MouseEvent) => {
            const drawState = useNetworkDrawStore.getState();
            if (drawState.isActive || drawState.isConnectionActive || drawState.isSelectActive) return;
            e.preventDefault();
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            // Cesium pick: 클릭한 위치의 엔티티 확인
            const rect = canvas.getBoundingClientRect();
            const pickPos = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
            const picked = viewer.scene.pick(pickPos);
            if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
                const props = picked.id.properties?.getValue(Cesium.JulianDate.now());
                if (props?.featureType === 'nodes' && props?.id != null) {
                    const pickedNode = network.nodes.find((n) => String(n.id) === String(props.id));
                    if (pickedNode) selectNodeAndShowToolbar(pickedNode, { x: e.clientX, y: e.clientY });
                    return;
                }
            }
            // 엔티티 미감지 시 지형 좌표 기반 노드 탐색
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
                selectNodeAndShowToolbar(nearestNode, { x: e.clientX, y: e.clientY });
            }
        };
        canvas.addEventListener('contextmenu', onCesiumContextMenu);
        return () => canvas.removeEventListener('contextmenu', onCesiumContextMenu);
    }, [viewer]);

    // ── 항상 활성: Ctrl+Z / Ctrl+Shift+Z → Undo / Redo ────────────
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                const current = useNetworkStore.getState().currentJsonData;
                if (!current) return;
                const prev = useNetworkUndoStore.getState().undo(current);
                if (prev) {
                    assignPropertyToResponseData(prev as any);
                    useNetworkStore.getState().setCurrentJsonData(prev);
                    useNetworkStore.getState().setChange(true);
                    useMessageStore.getState().setMessage({ type: 'info', text: '실행 취소 (Ctrl+Z)' });
                } else {
                    useMessageStore.getState().setMessage({ type: 'warn', text: '되돌릴 작업이 없습니다' });
                }
            } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                e.preventDefault();
                const current = useNetworkStore.getState().currentJsonData;
                if (!current) return;
                const next = useNetworkUndoStore.getState().redo(current);
                if (next) {
                    assignPropertyToResponseData(next as any);
                    useNetworkStore.getState().setCurrentJsonData(next);
                    useNetworkStore.getState().setChange(true);
                    useMessageStore.getState().setMessage({ type: 'info', text: '다시 실행 (Ctrl+Shift+Z)' });
                } else {
                    useMessageStore.getState().setMessage({ type: 'warn', text: '앞으로 실행할 작업이 없습니다' });
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // ── 항상 활성: import/OSM 교체 시 undo 스택 초기화 ─────────────
    useEffect(() => {
        return useNetworkStore.subscribe((state, prevState) => {
            const cur  = (state as any).importEpoch as number;
            const prev = (prevState as any).importEpoch as number;
            if (cur !== prev) {
                useNetworkUndoStore.getState().clear();
                useNetworkDrawStore.getState().clearChainEndpoint();
            }
        });
    }, []);

    // ── 항상 활성: 저장 안 된 변경사항이 있으면 탭 닫기/새로고침 경고 ──────
    // 부천시급 네트워크를 손으로 그리는 건 수 시간짜리 작업일 수 있는데, 그리기 자체는
    // 저장을 트리거하지 않고(finishSegment 등은 store만 갱신) 자동저장/이탈경고도 전혀
    // 없었다 — 탭이 실수로 닫히거나 새로고침되면 undo 스택(메모리 전용, 50단계)째로
    // 경고 없이 전부 유실됐다. LAYER_CONFIG 기준(DataIOPanel 저장 배지와 동일 판정)으로
    // 하나라도 isChanged 면 브라우저 기본 이탈 확인 다이얼로그를 띄운다.
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            // beforeunload 는 동기적으로만 응답 가능 — 동적 import 불가, 정적 import 필요.
            const hasChanges = LAYER_CONFIG.some(cfg => cfg.store.getState().isChanged);
            if (!hasChanges) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
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
        startNodeIdRef.current  = null;
        startWgs84Ref.current   = null;
        startLinkAnchorRef.current = null;
        snapNodeRef.current = null;
        lastOlCursorRef.current = null;

        // 교차로 지정 후 자동 시작점 설정 (outPort 없는 노드에서 draw 시작)
        const pendingId = useNetworkDrawStore.getState().pendingStartNodeId;
        const pendingCoord = useNetworkDrawStore.getState().pendingStartCoord;
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
                    text: `교차로 노드(${pendingId})에서 시작합니다.`,
                });
                setDrawGuide('segment');
            } else {
                setDrawGuide('start');
            }
        } else if (pendingCoord !== null) {
            // 빈 지형 클릭으로 그리기 시작(useNetworkSelect.ts의 beginDrawAt) — 스냅 노드 없이
            // 그 좌표를 그대로 시작점으로 삼는다. 재클릭 불필요.
            useNetworkDrawStore.getState().clearPendingStart();
            const olCoord = fromLonLat([pendingCoord.lng, pendingCoord.lat]);
            startOlCoordRef.current = olCoord;
            startNodeIdRef.current  = null;
            startWgs84Ref.current   = pendingCoord;
            setDrawGuide('segment');
        } else {
            // 이전 이어 그리기 체인의 끝점이 남아있으면(그리기 중지 → 팬 → 재시작) 자동 재개.
            // 타일 모드는 그리기 활성 중 팬이 동결되므로, 화면 밖으로 이어지는 도로는 이
            // 재개가 없으면 매번 끝점을 다시 찾아 클릭해야 한다. 그 노드가 팬 도중 타일에서
            // evict돼 더 이상 로드돼있지 않으면(화면 밖으로 멀리 이동한 경우) 조용히 포기하고
            // 새 시작점 선택으로 되돌아간다.
            const chainEndpoint = useNetworkDrawStore.getState().chainEndpoint;
            const data = useNetworkStore.getState().currentJsonData;
            const resumeNode = chainEndpoint ? data?.nodes.find(n => String(n.id) === chainEndpoint.nodeId) : null;
            if (chainEndpoint && resumeNode) {
                const olCoord = fromLonLat([resumeNode.coordinates.lng, resumeNode.coordinates.lat]);
                startOlCoordRef.current = olCoord;
                startNodeIdRef.current  = resumeNode.id;
                startWgs84Ref.current   = resumeNode.coordinates;
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: '이전 이어 그리기 끝점에서 계속합니다. (더블클릭으로 종료)',
                });
                setDrawGuide('segment');
            } else {
                if (chainEndpoint) useNetworkDrawStore.getState().clearChainEndpoint();
                setDrawGuide('start');
            }
        }

        // ── OL 공통 렌더링 함수 ──────────────────────────────────
        let dashOffset = 0;
        function renderOlPreview(cursor: Coordinate) {
            const data = useNetworkStore.getState().currentJsonData;
            const nodes = data?.nodes ?? [];
            const links = data?.links ?? [];
            const lonLat = toLonLat(cursor);
            const intersectionNodes = useNetworkDrawStore.getState().intersectionNodes;
            const taggedIds = new Set(Object.keys(intersectionNodes));

            // 스냅 우선순위: 노드 > 링크 > 자유점. Alt 누르면 스냅 전부 해제(자유점).
            // 교차로로 지정된 노드는 더 넓은 반경(TAGGED_SNAP_RADIUS_M)으로 스냅 — 하지만
            // findSnapNode는 항상 실제 로드된 노드 객체만 반환하므로 오판 병합 위험은 없다.
            // 고정 반경(m)은 줌아웃하면 화면상 좁은 과녁이 되므로 res(m/px) 기준 최소 픽셀
            // 크기와 고정값 중 큰 쪽을 쓴다(실측: 48m 떨어진 클릭이 스냅 안 돼 노드 옆에
            // 새 노드가 따로 생기는 문제로 재현 — SNAP_PIXEL_TARGET 참고).
            const res = olMap!.getView().getResolution() ?? 1;
            const nodeRadiusM = Math.max(SNAP_RADIUS_M, res * SNAP_PIXEL_TARGET);
            const linkRadiusM = Math.max(SNAP_LINK_RADIUS_M, res * SNAP_PIXEL_TARGET);
            const snapOff = altRef.current;
            const snapNode = snapOff ? null : findSnapNode(nodes, lonLat, taggedIds, nodeRadiusM);
            snapNodeRef.current = snapNode;

            const snapLink = snapOff ? null : findSnapLink(links, cursor, !!snapNode, linkRadiusM);
            linkSnapRef.current = snapLink;

            let effCoord: Coordinate;
            let snapIndicatorStyles: Style | Style[];

            // 정렬 스냅 탐색 — 기존 노드/링크 스냅과 반대로, Alt를 누르고 있을 때만 활성화한다
            // (실사용 요청: 평소엔 각도 스냅 없이 자유롭게 그리다가, 필요할 때만 Alt로 켜고 싶음).
            // snapOff(Alt 시) 이미 snapNode/snapLink를 강제로 null 처리해두므로 조건은
            // snapOff 하나로 충분하다.
            const alignSnap = (snapOff && !snapNode && !snapLink)
                ? findAlignmentSnap(nodes, links, cursor, lonLat)
                : null;

            if (snapNode) {
                effCoord = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
                snapIndicatorStyles = snapStyle;
            } else if (snapLink) {
                effCoord = snapLink.coord;
                snapIndicatorStyles = linkSnapStyle;
            } else if (alignSnap) {
                // 정렬 스냅: 도로 연장선 방향으로 커서 고정
                effCoord = alignSnap.coord;
                snapIndicatorStyles = alignSnapStyle;
            } else {
                // Shift 각도 스냅: 시작점이 있을 때 15° 단위로 제한
                effCoord = (shiftRef.current && startOlCoordRef.current)
                    ? applyAngleSnapOl(cursor, startOlCoordRef.current)
                    : cursor;
                snapIndicatorStyles = endNodePreviewStyle;
            }

            source.clear();

            // ── ⓪ 교차로로 지정된 노드는 항상 마커로 표시(커서 근접 여부 무관) ──
            //   화면 밖으로 팬해도 다시 이 노드 근처로 오면 바로 보여, 넓어진 스냅 반경과
            //   함께 정확히 이 지점에 스냅해 연결하기 쉽게 한다. 로드 안 돼있으면(타일
            //   evict) 경고 스타일로 구분해 "지금은 여기 그려도 실제로 안 붙는다"를 알린다.
            const nodeIdSet = new Set(nodes.map(n => String(n.id)));
            for (const [taggedId, coord] of Object.entries(intersectionNodes)) {
                const markerF = new Feature(new Point(fromLonLat([coord.lng, coord.lat])));
                markerF.setStyle(taggedNodeStyle(nodeIdSet.has(taggedId)));
                source.addFeature(markerF);
            }

            // ── ① 노드 정렬 가이드 레이 (snapNode 시 연결 링크 방향 확장선 + 방위각 라벨) ──
            if (snapNode) {
                const nodeOl = fromLonLat([snapNode.coordinates.lng, snapNode.coordinates.lat]);
                const RAY_LEN = 350;
                const rays = getAlignRayAngles(snapNode, links);
                // 중복 방향 제거 (180° 반대쌍은 같은 선이므로 하나만 그림)
                const drawnAngles = new Set<number>();
                for (const ray of rays) {
                    const normalised = ((ray.angle % Math.PI) + Math.PI) % Math.PI;
                    const key = Math.round(normalised * 100);
                    if (drawnAngles.has(key)) continue;
                    drawnAngles.add(key);
                    const ux = Math.cos(ray.angle), uy = Math.sin(ray.angle);
                    const rayF = new Feature(new LineString([
                        [nodeOl[0]! - ux * RAY_LEN, nodeOl[1]! - uy * RAY_LEN],
                        [nodeOl[0]! + ux * RAY_LEN, nodeOl[1]! + uy * RAY_LEN],
                    ]));
                    rayF.setStyle(alignRayStyle);
                    source.addFeature(rayF);
                    // 방위각 라벨
                    const labelPos = [nodeOl[0]! + ux * (RAY_LEN * 0.6), nodeOl[1]! + uy * (RAY_LEN * 0.6)];
                    const lbF = new Feature(new Point(labelPos));
                    lbF.setStyle(new Style({ text: new OlText({
                        text: `${ray.bearingDeg}°`,
                        font: '10px monospace',
                        fill: new Fill({ color: 'rgba(0,220,255,0.85)' }),
                        stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 2 }),
                        offsetY: -8,
                    })}));
                    source.addFeature(lbF);
                }
            }

            // ── ① 정렬 스냅 활성 시: 해당 연장선 강조 표시 ──
            if (alignSnap) {
                const ux = Math.cos(alignSnap.angle), uy = Math.sin(alignSnap.angle);
                const EXT = 800;
                const rayF = new Feature(new LineString([
                    [alignSnap.nodeOl[0]! - ux * EXT, alignSnap.nodeOl[1]! - uy * EXT],
                    [alignSnap.nodeOl[0]! + ux * EXT, alignSnap.nodeOl[1]! + uy * EXT],
                ]));
                rayF.setStyle(alignSnapActiveRayStyle);
                source.addFeature(rayF);
                // 기준 노드 표시
                const nodeDotF = new Feature(new Point(alignSnap.nodeOl));
                nodeDotF.setStyle(new Style({ image: new CircleStyle({
                    radius: 5, fill: new Fill({ color: 'rgba(50,255,180,0.8)' }),
                    stroke: new Stroke({ color: '#fff', width: 1.5 }),
                })}));
                source.addFeature(nodeDotF);
                // 방위각 라벨
                const midPt = [(alignSnap.nodeOl[0]! + effCoord[0]!) / 2, (alignSnap.nodeOl[1]! + effCoord[1]!) / 2];
                const alignLbF = new Feature(new Point(midPt));
                alignLbF.setStyle(new Style({ text: new OlText({
                    text: `⊙ ${alignSnap.bearingDeg}° 정렬`,
                    font: 'bold 11px monospace',
                    fill: new Fill({ color: 'rgba(50,255,180,1)' }),
                    stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 3 }),
                    offsetY: -14,
                    backgroundFill: new Fill({ color: 'rgba(0,0,0,0.4)' }),
                    padding: [2, 6, 2, 6],
                })}));
                source.addFeature(alignLbF);
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
        // splitEndFromLink: snapEnd가 방금 이 클릭으로 기존 링크를 분할해 만든 노드인 경우 true
        // — 완료 메시지에서 "기존 노드 스냅"이 아니라 "링크 분할로 생성된 노드"임을 구분해 안내한다.
        // junctionConfirmed: 아래 교차로 형성 confirm에서 사용자가 확인한 뒤 재진입할 때 true.
        function finishSegment(endOlCoord: Coordinate, endWgs84: Coordinates, snapEnd: Node | null, splitEndFromLink?: boolean, junctionConfirmed?: boolean) {
            const originalNetwork = useNetworkStore.getState().currentJsonData;
            if (!originalNetwork) return;
            // 시작점이 기존 링크 위(startLinkAnchorRef)였다면 여기서 처음 분할한다 — 그 결과가
            // 아래에서 store에 실제로 저장되는 건 이 함수가 끝까지 통과했을 때뿐이다. 자기루프/
            // 중복 링크/길이<1m 등으로 조기 return 하면 이 분할은 로컬 network 변수에만
            // 있다가 그냥 버려져 store엔 전혀 반영되지 않는다 — 취소와 완전히 동일한 효과.
            let network = originalNetwork;

            const ts = Date.now();
            const startWgs84 = startWgs84Ref.current!;
            const linkId = ts + 2;

            // ── fromNode 처리 ──────────────────────────────────
            let fromNodeId: number | string;
            let isNewFromNode = false;
            let splitAwayLinkId: string | null = null;
            if (startNodeIdRef.current != null) {
                fromNodeId = startNodeIdRef.current;
            } else if (startLinkAnchorRef.current) {
                const anchor = startLinkAnchorRef.current;
                const anchorLink = network.links.find(l => String(l.id) === String(anchor.linkId));
                if (anchorLink) {
                    const { updatedNetwork, newNodeId: splitNodeId } = splitLinkInNetwork(
                        network, anchorLink, startWgs84, ts, anchor.segIdx
                    );
                    network = updatedNetwork;
                    splitAwayLinkId = String(anchor.linkId);
                    fromNodeId = splitNodeId;
                } else {
                    // 앵커 링크가 그 사이 사라진 드문 경우 — 고립 노드로 대체.
                    fromNodeId = ts;
                    isNewFromNode = true;
                }
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

            // 자기루프(fromNode === toNode) 또는 극소 길이 링크 방지 (더블클릭 안전장치)
            if (!isNewFromNode && !isNewToNode && String(fromNodeId) === String(toNodeId)) return;
            const segLenM = getDistance([startWgs84.lng, startWgs84.lat], [endWgs84.lng, endWgs84.lat]);
            if (segLenM < 1) return;

            // ── 링크 중복 생성 방지 ──────────────────────────────
            // 두 끝점이 모두 기존 노드고 그 사이를 잇는 링크가 이미 있으면(방향 무관 —
            // A→B든 B→A든 이미 같은 두 노드를 잇는 도로가 있으면 중복) 새로 만들지 않는다.
            // 안 막으면 겹쳐 그려지는 평행 도로가 생기고, 그 노드의 커넥션(회전 규칙)이
            // 어느 링크를 기준으로 한 건지 꼬인다(2026-07-30 사용자 지적: 중복 노드 방지는
            // 만들었는데 중복 링크 방지가 없다는 지적 — 대칭 버전). 새로 만든 노드가
            // DUPLICATE_NODE_RADIUS_M 이내 기존 노드에 나중에 병합되는 경우는 이 시점엔
            // 아직 새 노드라 여기서 못 잡으므로, 병합 이후 아래에서 한 번 더 확인한다.
            if (!isNewFromNode && !isNewToNode) {
                const dupLink = network.links.find(l =>
                    (String(l.fromNode) === String(fromNodeId) && String(l.toNode) === String(toNodeId)) ||
                    (String(l.fromNode) === String(toNodeId) && String(l.toNode) === String(fromNodeId))
                );
                if (dupLink) {
                    useMessageStore.getState().setMessage({
                        type: 'warn',
                        text: `노드 ${String(fromNodeId)}↔${String(toNodeId)} 사이에 이미 도로(링크 ${String(dupLink.id)})가 있어 중복 생성을 막았습니다.`,
                    });
                    return;
                }
            }

            // ── 교차로 형성 confirm ─────────────────────────────
            // 이 연결로 기존 노드가 3방향 이상(JUNCTION_MIN_DEGREE) 교차로가 되면, 새 링크만
            // 후퇴(setback)하는 게 아니라 그 노드에 붙어 있는 "기존" 링크들도 함께 후퇴시켜
            // 완전한 교차로 형상으로 만든다(2026-07-30 사용자 확정: "교차로로 간주된다면
            // 교차로로 취급"). 기존 도로 형상이 바뀌는 작업이므로 먼저 confirm을 받는다 —
            // 실제로 잘릴 기존 링크(끝점이 노드에 붙어 있는 것)가 있을 때만 묻고, 이미 전부
            // 후퇴돼 있는 교차로(KTDB 등)에 다리만 추가하는 경우엔 조용히 진행한다.
            if (!junctionConfirmed) {
                const addedPerNode = isBidirectionalRef.current ? 2 : 1; // 양방향은 두 링크가 같은 노드쌍에 붙음
                const junctionTargets: Array<{ nodeId: number | string; afterDegree: number; flushCount: number }> = [];
                const endpoints: Array<[number | string, boolean]> = [[fromNodeId, isNewFromNode], [toNodeId, isNewToNode]];
                for (const [nid, isNew] of endpoints) {
                    if (isNew) continue;
                    const preview = junctionFormationPreview(network, nid, addedPerNode);
                    if (preview && preview.flushCount > 0) {
                        junctionTargets.push({ nodeId: nid, afterDegree: preview.afterDegree, flushCount: preview.flushCount });
                    }
                }
                if (junctionTargets.length > 0) {
                    const desc = junctionTargets
                        .map(t => `노드 ${String(t.nodeId)} (${t.afterDegree}방향, 기존 도로 ${t.flushCount}개 조정)`)
                        .join(', ');
                    useMessageStore.getState().setMessage({
                        type: 'confirm',
                        text: `이 연결로 교차로가 만들어집니다 — ${desc}. 접속된 기존 도로의 끝을 교차로 진입 전에서 후퇴(setback)시킵니다. 계속할까요?`,
                        onConfirm: () => finishSegment(endOlCoord, endWgs84, snapEnd, splitEndFromLink, true),
                    });
                    return;
                }
            }

            // undo는 분할 이전(originalNetwork)으로 되돌아가도록 — 분할+구간추가를 Ctrl+Z
            // 한 번에 함께 되돌린다(둘이 사실상 하나의 조작이므로).
            useNetworkUndoStore.getState().push(originalNetwork);
            // 여기까지 왔으면 실제로 구간이 완성된다 — 앵커를 소비했으니 지운다(조기 return한
            // 경우엔 앵커가 그대로 남아 재시도 가능하도록 여기까지 안 온다).
            startLinkAnchorRef.current = null;
            if (splitAwayLinkId) {
                // 분할로 사라진 원본 링크 — 타일 모드에서 MVT 잔상 마스킹
                useNetworkEditStore.getState().addDeleted([splitAwayLinkId]);
            }

            // O(links) 1회 빌드 → 이후 모든 find()를 O(1) Map 룩업으로 대체
            const linkMap = new Map<string, Link>(
                network.links.map(l => [String(l.id), l])
            );

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

            // ⚠️ 예전엔 여기서 "새로 생성된 노드가 교차로 지정 노드 근처(50m)면 자동 병합"을
            // 거리 기반으로 했는데, 조밀한 도심에서는 진짜 서로 다른 두 교차로가 50m 이내로
            // 붙어있는 경우가 흔해 잘못 병합될 위험이 있었다(사용자 지적). 지금은 "교차로로
            // 지정"이 순전히 스냅 대상 힌트(넓은 스냅 반경 + 항상 보이는 마커)일 뿐이라,
            // 태그된 노드에 실제로 연결하려면 findSnapNode가 그 노드를 snapEnd로 찾아줘야
            // 한다 — 그러면 아래(포트/커넥션 갱신)는 태그 여부와 무관하게 이미 동작하는
            // "기존 노드에 스냅" 경로를 그대로 타므로, 서로 다른 노드를 잘못 합칠 여지가
            // 전혀 없다(항상 정확히 같은 id의 실제 노드에만 연결됨).

            // ── 교차로 setback: 방금 만든 링크(newLink/reverseLink)가 닿은 노드가 이번
            // 편집으로 3방향 이상(실제 교차로)이 됐으면 끝을 후퇴시켜 connection이 그려질
            // 공간을 만든다. 기존 접속 링크들도 함께 후퇴시킨다(2026-07-30 사용자 확정:
            // "교차로로 간주된다면 교차로로 취급, 현재 연결되어 있는 링크들도 setback") —
            // 위 confirm 게이트에서 이미 사용자 동의를 받았고, 이미 후퇴된 링크(KTDB 등)는
            // setbackNewLinks 내부의 근접 가드(JUNCTION_ALREADY_SETBACK_EPS_M)가 걸러
            // 이중 후퇴하지 않는다.
            const setbackEntries: Array<{ linkId: number | string; nodeEnd: 'start' | 'end'; nodeId: number | string }> = [
                { linkId, nodeEnd: 'start', nodeId: fromNodeId },
                { linkId, nodeEnd: 'end',   nodeId: toNodeId },
            ];
            if (isBidirectionalRef.current) {
                const reverseId = ts + 3;
                setbackEntries.push(
                    { linkId: reverseId, nodeEnd: 'start', nodeId: toNodeId },
                    { linkId: reverseId, nodeEnd: 'end',   nodeId: fromNodeId },
                );
            }
            const seenSetback = new Set(setbackEntries.map(en => `${en.linkId}_${en.nodeEnd}`));
            for (const nid of new Set([String(fromNodeId), String(toNodeId)])) {
                const n = newNetwork.nodes.find(nn => String(nn.id) === nid);
                if (!n) continue;
                for (const p of n.ports) {
                    const l = newNetwork.links.find(ll => String(ll.id) === String(p.linkId));
                    if (!l) continue;
                    const nodeEnd: 'start' | 'end' = String(l.fromNode) === nid ? 'start' : 'end';
                    const key = `${l.id}_${nodeEnd}`;
                    if (seenSetback.has(key)) continue;
                    seenSetback.add(key);
                    setbackEntries.push({ linkId: l.id, nodeEnd, nodeId: nid });
                }
            }
            const finalNetwork = setbackNewLinks(newNetwork, setbackEntries);

            // ── 중복 노드 방어 ───────────────────────────────────────
            // 방금 새로 만든 노드가 기존의 다른 노드와 사실상 같은 위치(DUPLICATE_NODE_RADIUS_M
            // 이내)면, 진행 방향이 반대라도 같은 실물 지점으로 보고 즉시 병합한다 — 스냅에
            // 성공했어도 두 세그먼트가 살짝 어긋나 새 노드가 기존 노드 바로 옆에 따로 생기는
            // 경우의 안전망. 병합되면 그 끝점은 더 이상 "새 노드"가 아니라 "기존 노드에 병합된"
            // 것으로 취급 — 아래 history 로그/체인 이어그리기 참조가 전부 이 최종 id를 쓴다.
            let mergedNetwork = finalNetwork;
            const dedupeEndpoint = (nodeId: number | string): number | string => {
                const created = mergedNetwork.nodes.find(n => String(n.id) === String(nodeId));
                if (!created) return nodeId;
                let dup: Node | null = null;
                let dupDist = DUPLICATE_NODE_RADIUS_M;
                for (const n of mergedNetwork.nodes) {
                    if (String(n.id) === String(created.id)) continue;
                    const d = getDistance(
                        [n.coordinates.lng, n.coordinates.lat],
                        [created.coordinates.lng, created.coordinates.lat],
                    );
                    if (d < dupDist) { dupDist = d; dup = n; }
                }
                if (!dup) return nodeId;
                mergedNetwork = mergeNodesInNetwork(mergedNetwork, dup.id, created.id);
                return dup.id;
            };
            if (isNewFromNode) {
                const keptId = dedupeEndpoint(fromNodeId);
                if (String(keptId) !== String(fromNodeId)) { fromNodeId = keptId; isNewFromNode = false; }
            }
            if (isNewToNode) {
                const keptId = dedupeEndpoint(toNodeId);
                if (String(keptId) !== String(toNodeId)) { toNodeId = keptId; isNewToNode = false; }
            }

            // ── 링크 중복 생성 방지 (노드 병합 이후 재확인) ──────────
            // 위 조기 검사는 두 끝점이 애초에 기존 노드일 때만 잡는다. 방금 그린 새 노드가
            // 바로 위 중복 노드 병합으로 기존 노드에 흡수돼 fromNodeId/toNodeId가 뒤늦게
            // 기존 노드로 바뀐 경우, 그 결과 이미 있던 도로와 중복되는 사례를 여기서 한 번
            // 더 확인해 지운다 — 방금 만든 링크(+양방향이면 역방향 링크)만 제거하고
            // ports/connections는 deleteLinkFromNetwork가 정리해 흔적 없이 되돌린다.
            const reverseId = ts + 3;
            const dupAfterMerge = mergedNetwork.links.find(l =>
                String(l.id) !== String(linkId) &&
                (!isBidirectionalRef.current || String(l.id) !== String(reverseId)) &&
                ((String(l.fromNode) === String(fromNodeId) && String(l.toNode) === String(toNodeId)) ||
                 (String(l.fromNode) === String(toNodeId) && String(l.toNode) === String(fromNodeId)))
            );
            if (dupAfterMerge) {
                mergedNetwork = deleteLinkFromNetwork(mergedNetwork, linkId);
                if (isBidirectionalRef.current) mergedNetwork = deleteLinkFromNetwork(mergedNetwork, reverseId);
                useNetworkStore.getState().setCurrentJsonData(mergedNetwork);
                useNetworkStore.getState().setChange(true);
                useMessageStore.getState().setMessage({
                    type: 'warn',
                    text: `노드 ${String(fromNodeId)}↔${String(toNodeId)} 사이에 이미 도로(링크 ${String(dupAfterMerge.id)})가 있어 중복 생성을 막았습니다 — 기존 노드에 병합만 반영됩니다.`,
                });
                // 이어 그리기는 병합된 기존 노드에서 계속할 수 있게 시작점만 갱신.
                startOlCoordRef.current = endOlCoord;
                startNodeIdRef.current = toNodeId;
                startWgs84Ref.current = endWgs84;
                useNetworkDrawStore.getState().setChainEndpoint(toNodeId, endWgs84);
                return;
            }

            useNetworkStore.getState().setCurrentJsonData(mergedNetwork);
            useNetworkStore.getState().setChange(true);

            // ── history 로그 ─────────────────────────────────────────────
            const historyEntry: UpdateLogEntry = { added: [], modified: [] };

            // 신규 링크 (setback 반영된 최종 좌표/길이 기준)
            const addedLink = mergedNetwork.links.find(l => String(l.id) === String(linkId));
            if (addedLink) historyEntry.added!.push(...collectAdded(addedLink));

            // 역방향 링크 (양방향)
            if (isBidirectionalRef.current) {
                const reverseId = ts + 3;
                const addedRev = mergedNetwork.links.find(l => String(l.id) === String(reverseId));
                if (addedRev) historyEntry.added!.push(...collectAdded(addedRev));
            }

            // 신규 노드
            if (isNewFromNode) {
                const addedNode = mergedNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
                if (addedNode) historyEntry.added!.push(...collectAdded(addedNode));
            } else {
                const oldFN = network.nodes.find(n => String(n.id) === String(fromNodeId));
                const newFN = mergedNetwork.nodes.find(n => String(n.id) === String(fromNodeId));
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
                const addedNode = mergedNetwork.nodes.find(n => String(n.id) === String(toNodeId));
                if (addedNode) historyEntry.added!.push(...collectAdded(addedNode));
            } else {
                const oldTN = network.nodes.find(n => String(n.id) === String(toNodeId));
                const newTN = mergedNetwork.nodes.find(n => String(n.id) === String(toNodeId));
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

            // 시작/끝이 각각 새 노드인지 기존 노드에 스냅됐는지 명시 — "분명히 스냅했는데
            // 커넥션이 안 생긴다"는 문제를 조사할 때, 실제로는 스냅이 안 되고 근처에 별개의
            // 새 노드가 생겼을 가능성을 즉시 구분할 수 있게 한다.
            const endpointLabel = (isNew: boolean, nodeId: number | string, splitFrom?: boolean) =>
                isNew ? '새 노드' : splitFrom ? `링크 분할로 생성된 노드(${nodeId})` : `기존 노드(${nodeId}) 스냅`;
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `도로 추가 완료 (${laneCountRef.current}차선, ${Math.round(addedLink?.length ?? newLink.length)}m)`
                    + ` · 시작: ${endpointLabel(isNewFromNode, fromNodeId)} · 끝: ${endpointLabel(isNewToNode, toNodeId, splitEndFromLink)}`,
            });

            // 이어 그리기: 끝점을 새 시작점으로
            startOlCoordRef.current = endOlCoord;
            startNodeIdRef.current = toNodeId;
            startWgs84Ref.current = endWgs84;

            // 체인 끝점을 스토어에도 남겨둔다 — "그리기 중지" 후 화면 밖으로 팬했다가
            // 다시 "그리기 시작"을 눌러도(타일 모드는 그리기 중 팬이 동결되므로 넓은 지역을
            // 이어 그릴 땐 이 재시작이 불가피하다) 이 지점에서 자동으로 이어진다.
            useNetworkDrawStore.getState().setChainEndpoint(toNodeId, endWgs84);
        }
        finishSegmentRef.current = finishSegment;

        // ── OL 이벤트 핸들러 (capture phase → 다른 핸들러 차단) ──
        let olMoveRafId: number | null = null;

        // 팬 드래그와 점 찍기를 구분하기 위한 기준점. 네이티브 click 이벤트는 mousedown~up
        // 사이 이동거리와 무관하게 발생하므로(브라우저가 드래그라고 자체적으로 click을
        // 걸러주지 않음), pointerdown 위치를 기록해뒀다가 click 시점에 이동거리를 직접
        // 검사한다 — 그렇지 않으면 지도를 드래그로 팬하려는 클릭마다 그 자리에 점이 찍힌다.
        let pointerDownPos: { x: number; y: number } | null = null;
        const DRAG_CLICK_THRESHOLD_SQ = 36; // 6px
        const onPointerDown = (e: PointerEvent) => {
            pointerDownPos = { x: e.clientX, y: e.clientY };
        };

        const onPointerMove = (e: PointerEvent) => {
            // stopPropagation 하지 않음 — 막으면 드래그 팬 중 OL DragPan이 move를 못 받아
            // pointerdown은 되는데 실제로 지도가 안 움직이는 문제가 생긴다. 프리뷰 렌더링은
            // 전파를 막을 필요가 없는 순수 부가 동작이라 그냥 흘려보내도 무방하다.
            const coord = olMap.getEventCoordinate(e);
            lastOlCursorRef.current = coord;
            // RAF 스로틀: 프레임당 1회만 snap 계산 + 렌더링
            if (olMoveRafId !== null) return;
            olMoveRafId = requestAnimationFrame(() => {
                olMoveRafId = null;
                // 3D 모드에서는 OL 프리뷰 불필요 (Cesium이 주 편집 맵)
                if (useMapStore.getState().mapViewMode === '3D') return;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            });
        };

        const onClick = (e: MouseEvent) => {
            e.stopPropagation();   // 다른 OL 핸들러로 전달 차단

            // 지도를 패닝하려던 드래그였다면(mousedown~click 사이 이동거리가 큼) 점을
            // 찍지 않고 무시 — 이동거리 검사는 위 pointerDownPos 주석 참고.
            if (pointerDownPos) {
                const dx = e.clientX - pointerDownPos.x;
                const dy = e.clientY - pointerDownPos.y;
                if (dx * dx + dy * dy > DRAG_CLICK_THRESHOLD_SQ) return;
            }

            // 더블클릭의 2번째 click: 이어 그리기 체인 종료 (draw 모드 유지)
            if (e.detail >= 2) {
                startOlCoordRef.current = null;
                startNodeIdRef.current  = null;
                startWgs84Ref.current   = null;
                startLinkAnchorRef.current = null;
                snapNodeRef.current     = null;
                source.clear();
                useNetworkDrawStore.getState().clearChainEndpoint();
                useMessageStore.getState().setMessage({ type: 'info', text: '이어 그리기를 끝냈습니다.' });
                setDrawGuide('start');
                return;
            }

            // snapNodeRef/linkSnapRef는 pointermove의 requestAnimationFrame 스로틀
            // (renderOlPreview) 안에서만 갱신된다 — 커서가 노드 위로 막 이동한 직후 그 프레임이
            // 돌기 전에 곧바로 클릭하면, 여기서 읽는 값이 "한 프레임 전(=조금 전 위치)"의
            // 스냅 판정이라 실제로는 노드 위인데 스냅이 안 된 것으로 보일 수 있다. 프리뷰용
            // 캐시에 기대지 말고 클릭 좌표로 스냅을 항상 새로 계산해 정확히 맞춘다.
            // ⚠️ 실측(2026-07-30): 노드에서 48m 떨어진 클릭도 화면상으론 "가까이 클릭한"
            // 것처럼 보였지만 고정 25m 반경(SNAP_RADIUS_M)을 넘어서 스냅 실패 — 노드에 연결
            // 안 되고 옆에 새 노드가 따로 생기는 문제로 재현됨(포트 개수와는 무관, 순수 거리
            // 문제였다). renderOlPreview와 동일하게 res(m/px) 기준 반경을 함께 적용한다.
            const clickOlCoord = olMap.getEventCoordinate(e);
            const clickLonLat  = toLonLat(clickOlCoord);
            const clickNetwork = useNetworkStore.getState().currentJsonData;
            const clickTaggedIds = new Set(Object.keys(useNetworkDrawStore.getState().intersectionNodes));
            const clickSnapOff = altRef.current;
            const clickRes = olMap.getView().getResolution() ?? 1;
            const clickNodeRadiusM = Math.max(SNAP_RADIUS_M, clickRes * SNAP_PIXEL_TARGET);
            const clickLinkRadiusM = Math.max(SNAP_LINK_RADIUS_M, clickRes * SNAP_PIXEL_TARGET);
            const snapNode = clickSnapOff ? null : findSnapNode(clickNetwork?.nodes ?? [], clickLonLat, clickTaggedIds, clickNodeRadiusM);
            const snapLink = clickSnapOff ? null : findSnapLink(clickNetwork?.links ?? [], clickOlCoord, !!snapNode, clickLinkRadiusM);
            snapNodeRef.current = snapNode;
            linkSnapRef.current = snapLink;

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

            // 편집모드 로드뷰가 "지도 중심"이 아니라 방금 확정한 이 점을 바로 따라가도록 알림
            // (useNaverPanorama가 구독 — 지도 pan 임계값과 무관하게 즉시 이동).
            useNetworkDrawStore.getState().setLastDrawnPoint(chosenWgs84);

            // ── 링크 스냅: 시작점을 기존 링크 위에 지정(분할은 구간 완성 시점으로 지연) ──
            // 여기서는 어떤 링크의 어느 세그먼트인지만 기억해두고 데이터는 전혀 바꾸지
            // 않는다 — 실제 분할은 finishSegment가 구간을 완성할 때 수행한다. 클릭만으로
            // 네트워크가 바뀌지 않으므로 이후 취소해도 되돌릴 것 자체가 없다.
            if (!snapNode && snapLink && !startOlCoordRef.current) {
                startLinkAnchorRef.current = { linkId: snapLink.link.id, segIdx: snapLink.segIdx };
                startOlCoordRef.current  = chosenOl;
                startNodeIdRef.current   = null;
                startWgs84Ref.current    = chosenWgs84;
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: '시작점을 지정했습니다. 끝점을 클릭하면 이 도로를 분할해 연결합니다.',
                });
                setDrawGuide('segment');
                return;
            }

            if (!snapNode && snapLink && startOlCoordRef.current) {
                // 끝점이 기존 링크 위: 분할 후 해당 노드로 연결
                const network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                useNetworkUndoStore.getState().push(network);
                const ts = Date.now();
                const { updatedNetwork, newNodeId } = splitLinkInNetwork(
                    network, snapLink.link, chosenWgs84, ts
                );
                useNetworkStore.getState().setCurrentJsonData(updatedNetwork);
                // 분할된 원본 링크 — 타일 모드에서 MVT 잔상 마스킹
                useNetworkEditStore.getState().addDeleted([String(snapLink.link.id)]);
                // finishSegment는 최신 network를 getState로 읽으므로
                // split 후 store가 반영된 뒤에 실행
                const splitNode = updatedNetwork.nodes.find(n => n.id === newNodeId) ?? null;
                finishSegment(chosenOl, chosenWgs84, splitNode, true);
                return;
            }

            // ── 일반 처리 ─────────────────────────────────────────
            if (!startOlCoordRef.current) {
                startOlCoordRef.current  = chosenOl;
                startNodeIdRef.current   = snapNode?.id ?? null;
                startWgs84Ref.current    = snapNode ? snapNode.coordinates : chosenWgs84;
                setDrawGuide('segment');
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
                const hitNode = findNearestNodeForContextMenu(olMap, me, network);
                if (hitNode) {
                    selectNodeAndShowToolbar(hitNode, { x: me.clientX, y: me.clientY });
                    return; // 취소 동작 하지 않음
                }
            }

            // 노드 없음 → 구간 취소 / 그리기 종료. 시작점이 기존 링크 위였어도 실제 분할은
            // 아직 안 일어난 상태(finishSegment에서만 일어남)라 되돌릴 데이터가 없다 —
            // 참조만 비우면 끝.
            if (startOlCoordRef.current) {
                startOlCoordRef.current = null;
                startNodeIdRef.current = null;
                startWgs84Ref.current = null;
                startLinkAnchorRef.current = null;
                source.clear();
                useMessageStore.getState().setMessage({ type: 'info', text: '구간을 취소했습니다.' });
                setDrawGuide('start');
            } else {
                // 시작점 없는 상태에서 우클릭 취소 = "그리기 자체를 그만두겠다" → 선택 모드로 복귀
                // (모드 버튼이 없으므로 여기서 안 돌려보내면 사용자가 다시 손 댈 방법이 없어짐).
                useNetworkDrawStore.getState().exitToSelect();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Shift') {
                shiftRef.current = true;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
            if (e.key === 'Alt') {
                e.preventDefault(); // Alt 기본동작(메뉴 포커스) 방지
                altRef.current = true;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
            // ESC = 그리기 완전 종료 → 선택 모드로 복귀(모드 버튼이 없으므로 필수).
            if (e.key === 'Escape') {
                useNetworkDrawStore.getState().exitToSelect();
            }
            // 숫자 1~8 = 차선 수 즉시 지정, [·] = 1개씩 증감 — 그리는 중 마우스를 상단
            // 설정바까지 옮기지 않고 손 위치 그대로 바꿀 수 있게(2026-07-30 실사용 요청:
            // "링크를 그리다가 손쉽게 차선의 수를 변경하고 싶음"). 이미 그려둔 링크는 안
            // 건드리고, 지금부터 이어 그릴 다음 구간부터 새 값이 적용된다(laneCountRef가
            // 이 store를 실시간 구독). 프리뷰 라벨("…m · …° · N차선")이 바로 갱신되어
            // 마우스를 움직이지 않아도 바뀐 값이 즉시 보인다.
            // 단, 설정바의 "폭" 숫자 입력 등 텍스트 입력에 포커스가 있을 때는 그 입력을
            // 방해하면 안 되므로(타이핑한 숫자가 엉뚱하게 차선 수도 바꿔버림) 건너뛴다.
            const activeEl = document.activeElement as HTMLElement | null;
            const typingInField = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
            if (!typingInField && /^[1-8]$/.test(e.key)) {
                useNetworkDrawStore.getState().setLaneCount(Number(e.key));
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
            if (!typingInField && e.key === '[') {
                useNetworkDrawStore.getState().setLaneCount(Math.max(1, laneCountRef.current - 1));
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
            if (!typingInField && e.key === ']') {
                useNetworkDrawStore.getState().setLaneCount(Math.min(8, laneCountRef.current + 1));
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift') {
                shiftRef.current = false;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
            if (e.key === 'Alt') {
                altRef.current = false;
                if (lastOlCursorRef.current) renderOlPreview(lastOlCursorRef.current);
            }
        };

        // capture: true → 이벤트가 다른 OL 핸들러에 도달하기 전에 가로챔.
        // pointerdown/pointerup 자체는 stopPropagation 하지 않는다 — 막으면 OL DragPan이
        // pointerdown을 아예 못 봐서 그리기 중엔 지도 자체를 못 움직이게 된다. pointerdown은
        // 위치 기록용으로만 사용(팬 드래그 판별, onClick 참고). dblclick은 여전히 막아야
        // 이어그리기 종료용 더블클릭이 지도 확대로 새는 것을 방지할 수 있다.
        const blockPointerDown = (e: Event) => e.stopPropagation();
        const vp = olMap.getViewport();
        vp.addEventListener('pointerdown', onPointerDown, true);
        vp.addEventListener('pointermove', onPointerMove, true);
        vp.addEventListener('click', onClick, true);
        vp.addEventListener('dblclick', blockPointerDown, true);
        vp.addEventListener('contextmenu', onContextMenu, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);

        return () => {
            if (olMoveRafId !== null) cancelAnimationFrame(olMoveRafId);
            clearInterval(dashAnimInterval);
            shiftRef.current = false;
            altRef.current = false;
            vp.removeEventListener('pointerdown', onPointerDown, true);
            vp.removeEventListener('pointermove', onPointerMove, true);
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
            useEditGuideStore.getState().clear();
        };
    }, [olMap, isActive, drawResetKey]);

    // ── Cesium 이벤트 & 프리뷰 (2D 전용 모드에선 비활성) ──────────────────────────────────
    useEffect(() => {
        if (NETWORK_EDIT_2D_ONLY) return; // 도로 그리기는 2D(OL)에서만
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
                // 2D 모드에서는 Cesium 프리뷰 불필요 (OL이 주 편집 맵)
                if (useMapStore.getState().mapViewMode === '2D') return;

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
                updateCesiumPreview(ds, endWgs84, snapNode, snapLink, startWgs84Ref.current, linkWidthRef.current, shiftRef.current, viewer);
            });
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // LEFT_CLICK
        let lastCesiumClickTime = 0;
        handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            // 더블클릭의 2번째 클릭: 이어 그리기 체인 종료 (draw 모드 유지)
            const now = Date.now();
            const isDbl = now - lastCesiumClickTime < 300;
            lastCesiumClickTime = now;
            if (isDbl) {
                startOlCoordRef.current = null;
                startNodeIdRef.current  = null;
                startWgs84Ref.current   = null;
                ds.entities.removeAll();
                olSrcRef.current?.clear();
                useMessageStore.getState().setMessage({ type: 'info', text: '이어 그리기 종료. 새 시작점을 클릭하세요.' });
                return;
            }

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
                useNetworkUndoStore.getState().push(network);
                const ts = Date.now();
                const { updatedNetwork, newNodeId } = splitLinkInNetwork(
                    network, snapLink.link, chosenWgs84, ts
                );
                useNetworkStore.getState().setCurrentJsonData(updatedNetwork);
                useNetworkStore.getState().setChange(true);
                useNetworkEditStore.getState().addDeleted([String(snapLink.link.id)]);

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
        // laneIdx === -1 → 링크 전체(ALL) 선택 (일괄 연결 모드)
        type FromSel = { linkId: number | string; laneIdx: number } | null;
        let fromSel: FromSel = null;

        // 드래그 생성 상태: from 점에서 pointerdown → to 점에서 pointerup 으로 커넥션 생성
        let dragConn: { fromLinkId: number | string; laneIdx: number; anchor: Coordinate; moved: boolean; startPx: [number, number] } | null = null;
        let dragPreviewFt: Feature | null = null;
        let suppressClickUntil = 0; // 드래그 생성 직후 따라오는 click 이벤트 무시

        /** 링크 단위 일괄 연결 차선쌍 (백엔드 lanePairs와 동일 규칙) */
        function lanePairsFor(turning: TurningType, inL: number, outL: number): Array<[number, number]> {
            if (turning === 'Left_Turn' || turning === 'U_Turn') return [[0, 0]];
            if (turning === 'Right_Turn') return [[inL - 1, outL - 1]];
            const pairs: Array<[number, number]> = [];
            const cnt = Math.min(inL, outL);
            for (let k = 0; k < cnt; k++) pairs.push([k, k]);
            for (let k = cnt; k < inL; k++) pairs.push([k, outL - 1]);
            for (let k = cnt; k < outL; k++) pairs.push([inL - 1, k]);
            return pairs;
        }

        /** 커넥션 일괄 커밋 — 중복 제외, 단일 undo/히스토리. U턴은 Left_Turn으로 저장(백엔드 규약). */
        function commitConnections(
            pairs: Array<{ fromLink: Link; fromLane: number; toLink: Link; toLane: number }>,
        ): number {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network || !selectedNodeId) return 0;
            const node = network.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
            if (!node) return 0;

            const newConns: Connection[] = [];
            for (const p of pairs) {
                if (p.fromLane < 0 || p.fromLane >= p.fromLink.numLane) continue;
                if (p.toLane < 0 || p.toLane >= p.toLink.numLane) continue;
                const exists = node.connections.some((c: any) =>
                    String(c.fromLink) === String(p.fromLink.id) && c.fromLane === p.fromLane &&
                    String(c.toLink) === String(p.toLink.id) && c.toLane === p.toLane
                ) || newConns.some((c: any) =>
                    String(c.fromLink) === String(p.fromLink.id) && c.fromLane === p.fromLane &&
                    String(c.toLink) === String(p.toLink.id) && c.toLane === p.toLane
                );
                if (exists) continue;

                const rawTurning = classifyTurning(linkArrivalBearing(p.fromLink), linkDepartureBearing(p.toLink));
                const turning = rawTurning === 'U_Turn' ? 'Left_Turn' : rawTurning;
                const laneWidth = p.toLink.width / p.toLink.numLane;
                const fromLaneCoord = p.fromLink.coordinates[p.fromLink.coordinates.length - 1]!;
                const toLaneCoord = p.toLink.coordinates[0]!;
                // ⚠️ 실측 지적: length:0 고정은 division-by-zero/0-size 배열 계산이 있는
                // 다운스트림(NextSim)에서 위험할 수 있다 — makeConnections와 동일하게 실제
                // 좌표 거리로 계산.
                const connLength = getDistance([fromLaneCoord.lng, fromLaneCoord.lat], [toLaneCoord.lng, toLaneCoord.lat]);
                newConns.push({
                    featureType: 'connections' as any,
                    id: node.connections.length + newConns.length,
                    fromLink: p.fromLink.id, fromLane: p.fromLane,
                    fromLaneCoordinates: fromLaneCoord,
                    toLink: p.toLink.id, toLane: p.toLane,
                    toLaneCoordinates: toLaneCoord,
                    turning, length: connLength, width: laneWidth,
                    ffSpd: Math.min(p.fromLink.maxSpd, p.toLink.maxSpd),
                    shape: '', coordinates: [],
                } as Connection);
            }
            if (newConns.length === 0) return 0;

            useNetworkUndoStore.getState().push(network);
            const updatedNodes = network.nodes.map((n: any) =>
                String(n.id) === String(selectedNodeId)
                    ? { ...n, connections: [...n.connections, ...newConns], numConnection: n.connections.length + newConns.length }
                    : n
            );
            const newNetwork: Network = { ...network, nodes: updatedNodes };
            assignPropertyToResponseData(newNetwork as any);
            useNetworkStore.getState().setCurrentJsonData(newNetwork);
            useNetworkStore.getState().setChange(true);

            const addedNode = newNetwork.nodes.find((n: any) => String(n.id) === String(selectedNodeId));
            if (addedNode) {
                const added = addedNode.connections.slice(addedNode.connections.length - newConns.length);
                useNetworkHistoryStore.getState().setUpdateLogs({
                    added: added.flatMap((c: any) => collectAdded(c)),
                    modified: [{
                        guid: addedNode.__guid!, field: 'numConnection',
                        oldValue: node.connections.length, newValue: addedNode.connections.length,
                    }],
                });
            }
            return newConns.length;
        }

        /** to(파랑) 차선 점 / toAll 핸들에 연결 — 클릭·드래그 공용. fromSel 유지(연속 생성). */
        function handleToTarget(feat: Feature): void {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network || !selectedNodeId || !fromSel) return;
            const toLinkId = feat.get('_linkId');
            const isAllTarget = feat.get('_type') === 'toAll';
            const fromLink = network.links.find((l: any) => String(l.id) === String(fromSel!.linkId));
            const toLink = network.links.find((l: any) => String(l.id) === String(toLinkId));
            if (!fromLink || !toLink) return;

            const rawTurning = classifyTurning(linkArrivalBearing(fromLink), linkDepartureBearing(toLink));
            const pairs: Array<{ fromLink: Link; fromLane: number; toLink: Link; toLane: number }> = [];
            if (fromSel.laneIdx === -1 || isAllTarget) {
                // 한쪽이라도 ALL → 링크 단위 일괄 규칙
                for (const [a, b] of lanePairsFor(rawTurning, fromLink.numLane, toLink.numLane)) {
                    pairs.push({ fromLink, fromLane: a, toLink, toLane: b });
                }
            } else {
                pairs.push({ fromLink, fromLane: fromSel.laneIdx, toLink, toLane: feat.get('_laneIdx') as number });
            }

            const created = commitConnections(pairs);
            const uturnNote = rawTurning === 'U_Turn' ? ' (U턴→좌회전 저장)' : '';
            useMessageStore.getState().setMessage(created > 0
                ? { type: 'info', text: `Connection ${created}개 생성${uturnNote} — 계속 연결하거나 [ESC]` }
                : { type: 'warn', text: '이미 존재하는 connection입니다.' });
            phase = 'lane';
            renderLanePhase(); // fromSel 유지 → 연속 생성
        }

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
            useEditGuideStore.getState().setGuide({
                title: '커넥션 편집 — 교차로 선택',
                steps: [
                    { keys: ['클릭'], text: '편집할 교차로(노드)를 클릭하세요', em: true },
                    { text: '파란 원 = 커넥션 있음 · 주황 원 = 커넥션 없음 (위 숫자 = 커넥션 수)' },
                    { keys: ['ESC'], text: '커넥션 편집 끝내기' },
                ],
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
                const connTurning = normalizeTurning(conn.turning);
                const color  = TURN_COLOR[connTurning] ?? 'rgba(160,160,160,0.7)';
                const dx = toOl[0]! - fromOl[0]!; const dy = toOl[1]! - fromOl[1]!;
                const angle = Math.atan2(dy, dx);

                const lineF = new Feature(new LineString(connCurveOl(fromOl, nodeOl, toOl, connTurning)));
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
                        text: connTurning === 'Straight' ? '↑' : connTurning === 'Right_Turn' ? '→' : '←',
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

            // 링크 전체(ALL) 핸들 — 클릭/드래그로 두 링크의 차선 전체를 규칙대로 일괄 연결
            for (const link of inLinks) {
                const f = new Feature(new Point(allHandleCoord(link, 'in')));
                f.set('_type', 'fromAll');
                f.set('_linkId', link.id);
                f.setStyle(new Style({
                    image: new RegularShape({
                        points: 4, radius: 9, angle: Math.PI / 4,
                        fill: new Fill({ color: 'rgba(255,70,70,0.9)' }),
                        stroke: new Stroke({ color: '#fff', width: 2 }),
                    }),
                    text: new OlText({ text: 'ALL', font: 'bold 8px sans-serif', fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 2 }), offsetY: -16 }),
                }));
                src.addFeature(f);
            }
            for (const link of outLinks) {
                const f = new Feature(new Point(allHandleCoord(link, 'out')));
                f.set('_type', 'toAll');
                f.set('_linkId', link.id);
                f.setStyle(new Style({
                    image: new RegularShape({
                        points: 4, radius: 9, angle: Math.PI / 4,
                        fill: new Fill({ color: 'rgba(60,130,255,0.9)' }),
                        stroke: new Stroke({ color: '#fff', width: 2 }),
                    }),
                    text: new OlText({ text: 'ALL', font: 'bold 8px sans-serif', fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 2 }), offsetY: -16 }),
                }));
                src.addFeature(f);
            }

            const connCount = node.connections?.length ?? 0;
            useEditGuideStore.getState().setGuide({
                title: `커넥션 편집 — 연결 만들기 (현재 ${connCount}개)`,
                steps: [
                    { keys: ['드래그'], text: '빨간 점(들어오는 차선)을 잡아 파란 점(나가는 차선)으로 끌면 연결됩니다', em: true },
                    { keys: ['클릭'], text: '빨간 점 → 파란 점 순서로 클릭해도 됩니다 (연속 생성)' },
                    { keys: ['◆ALL'], text: 'ALL 핸들끼리 이으면 두 링크의 모든 차선을 규칙대로 한 번에 연결' },
                    { keys: ['A'], text: '자동완성 — 가능한 모든 방향의 커넥션을 자동 생성' },
                    { keys: ['화살표 클릭'], text: '이미 만든 커넥션 하나 삭제' },
                    { keys: ['Del'], text: '이 교차로의 커넥션 전체 삭제' },
                    { keys: ['ESC'], text: '교차로 선택으로 돌아가기' },
                ],
                tip: 'U턴 연결도 가능합니다 (좌회전으로 저장돼요).',
            });
        }

        /** 링크 전체(ALL) 핸들 좌표 — 중심선 끝점에서 노드 반대쪽으로 오프셋 (차선 점들과 분리) */
        function allHandleCoord(link: Link, which: 'in' | 'out'): Coordinate {
            const res = olMap!.getView().getResolution() ?? 1;
            const cs = link.coordinates;
            const endIdx = which === 'in' ? cs.length - 1 : 0;
            const refIdx = which === 'in' ? Math.max(0, cs.length - 2) : Math.min(cs.length - 1, 1);
            const end = fromLonLat([cs[endIdx]!.lng, cs[endIdx]!.lat]);
            const ref = fromLonLat([cs[refIdx]!.lng, cs[refIdx]!.lat]);
            const d = Math.hypot(ref[0]! - end[0]!, ref[1]! - end[1]!) || 1;
            const off = res * 28;
            return [end[0]! + (ref[0]! - end[0]!) / d * off, end[1]! + (ref[1]! - end[1]!) / d * off];
        }

        // ── Phase 3: Lane 선택 강조 추가 ─────────────────────
        function renderLanePhase() {
            renderEditPhase();
            if (!fromSel || !selectedNodeId) return;
            const network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            const fromLink = network.links.find((l: any) => String(l.id) === String(fromSel!.linkId));
            if (!fromLink) return;
            const isAll = fromSel.laneIdx === -1;
            const coord = isAll
                ? allHandleCoord(fromLink, 'in')
                : getLaneEndpointOl(fromLink, fromSel.laneIdx, 'target');
            const f = new Feature(new Point(coord));
            f.setStyle(new Style({
                image: isAll
                    ? new RegularShape({
                        points: 4, radius: 11, angle: Math.PI / 4,
                        fill: new Fill({ color: 'rgba(255,60,60,1)' }),
                        stroke: new Stroke({ color: '#ffff00', width: 3 }),
                    })
                    : new CircleStyle({
                        radius: 9,
                        fill: new Fill({ color: 'rgba(255,60,60,1)' }),
                        stroke: new Stroke({ color: '#ffff00', width: 3 }),
                    }),
            }));
            src.addFeature(f);
            useEditGuideStore.getState().setGuide({
                title: isAll
                    ? `링크 ${fromSel.linkId} 전체 선택됨 — 일괄 연결`
                    : `링크 ${fromSel.linkId}의 ${fromSel.laneIdx}번 차선 선택됨`,
                steps: [
                    isAll
                        ? { keys: ['클릭'], text: '파란 ALL(또는 차선 점)을 클릭하면 모든 차선이 한 번에 연결됩니다', em: true }
                        : { keys: ['클릭'], text: '파란 점을 클릭할 때마다 커넥션이 만들어집니다 — 여러 개 연속 생성 가능', em: true },
                    { text: '같은 빨간 점을 다시 클릭하면 선택이 풀립니다' },
                    { keys: ['ESC'], text: '선택 취소' },
                ],
                tip: '잘못 만들었다면 흰 화살표를 클릭해 삭제하거나 Ctrl+Z로 되돌리세요.',
            });
        }

        // ── 자동 connection 생성 ──────────────────────────────
        function autoGenConnections() {
            if (!selectedNodeId) return;
            let network = useNetworkStore.getState().currentJsonData;
            if (!network) return;
            useNetworkUndoStore.getState().push(network);
            network = regenerateNodeConnections(network, selectedNodeId);
            assignPropertyToResponseData(network as any);
            useNetworkStore.getState().setCurrentJsonData(network);
            useNetworkStore.getState().setChange(true);
            renderEditPhase();
            useMessageStore.getState().setMessage({ type: 'info', text: '자동완성: S/L/R connection 생성 완료' });
        }

        renderNodePhase();

        // 노드 선택 맥락 툴바의 "커넥션 편집" 버튼으로 진입한 경우 — 지도에서 노드를 다시
        // 클릭할 필요 없이 그 노드로 곧장 phase='edit' 점프(클릭 핸들러의 node phase 진입
        // 로직, L2467-2482과 동일한 처리를 재현).
        {
            const pendingConnNodeId = useNetworkDrawStore.getState().pendingConnNodeId;
            if (pendingConnNodeId != null) {
                useNetworkDrawStore.getState().clearPendingConnNode();
                const network = useNetworkStore.getState().currentJsonData;
                const targetNode = network?.nodes.find((n: any) => String(n.id) === String(pendingConnNodeId));
                if (targetNode) {
                    selectedNodeId = targetNode.id;
                    phase = 'edit';
                    fromSel = null;
                    const view = olMap.getView();
                    const curRes = view.getResolution() ?? 1;
                    const EDIT_RES = 0.28; // renderNodePhase 클릭 핸들러와 동일 임계값
                    const center = fromLonLat([targetNode.coordinates.lng, targetNode.coordinates.lat]);
                    if (curRes > EDIT_RES + 0.02) {
                        view.animate({ center, resolution: EDIT_RES, duration: 350 }, () => renderEditPhase());
                    } else {
                        renderEditPhase();
                    }
                }
            }
        }

        // ── 클릭 이벤트 ──────────────────────────────────────
        const CLICK_TOL = 14;
        const onClick = (e: MouseEvent) => {
            e.stopPropagation();
            if (Date.now() < suppressClickUntil) return; // 드래그 생성 직후 click 무시
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
                // 줌이 얕으면 차선 점들이 겹쳐 클릭 불가 → 교차로 중심으로 자동 줌인
                const view = olMap.getView();
                const curRes = view.getResolution() ?? 1;
                const EDIT_RES = 0.28; // 차선 점 간격(~3.5m)이 12px 이상 되는 해상도
                if (curRes > EDIT_RES + 0.02) {
                    const geom = feat.getGeometry();
                    const center = geom instanceof Point ? geom.getCoordinates() : clickCoord;
                    view.animate({ center, resolution: EDIT_RES, duration: 350 }, () => renderEditPhase());
                    return;
                }
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
                    useNetworkUndoStore.getState().push(network);
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
                if (type === 'from' || type === 'fromAll') {
                    const linkId = feat.get('_linkId');
                    const laneIdx = type === 'fromAll' ? -1 : feat.get('_laneIdx') as number;
                    // 같은 from 재클릭 → 선택 해제
                    if (fromSel && String(fromSel.linkId) === String(linkId) && fromSel.laneIdx === laneIdx) {
                        fromSel = null; phase = 'edit'; renderEditPhase(); return;
                    }
                    fromSel = { linkId, laneIdx };
                    phase = 'lane'; renderLanePhase(); return;
                }
                if ((type === 'to' || type === 'toAll') && phase === 'lane' && fromSel) {
                    handleToTarget(feat); // 생성 후 fromSel 유지 → 연속 생성
                }
            }
        };

        // ── 키보드 ────────────────────────────────────────────
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (phase === 'lane') { fromSel = null; phase = 'edit'; renderEditPhase(); }
                else if (phase === 'edit') { phase = 'node'; selectedNodeId = null; renderNodePhase(); }
                // node phase에서 한 번 더 ESC = 커넥션 편집 완전 종료 → 선택 모드로 복귀
                // (모드 버튼이 없으므로 필수 — setConnectionActive(false) 단독으론 갈 곳이 없음).
                else { useNetworkDrawStore.getState().exitToSelect(); }
            }
            if ((e.key === 'a' || e.key === 'A') && phase === 'edit') autoGenConnections();
            if ((e.key === 'Delete' || e.key === 'Backspace') && phase === 'edit' && selectedNodeId) {
                let network = useNetworkStore.getState().currentJsonData;
                if (!network) return;
                useNetworkUndoStore.getState().push(network);
                const updatedNodes = network.nodes.map((n: any) =>
                    String(n.id) === String(selectedNodeId) ? { ...n, connections: [], numConnection: 0 } : n
                );
                const newNetwork: Network = { ...network, nodes: updatedNodes };
                assignPropertyToResponseData(newNetwork as any);
                useNetworkStore.getState().setCurrentJsonData(newNetwork);
                useNetworkStore.getState().setChange(true);
                renderEditPhase();
                const clearedCount = reconcileSignalConnectionIds(newNetwork, [selectedNodeId]);
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `교차로 connection 전체 삭제${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}`,
                });
            }
        };

        // ── 드래그 생성: from(빨강/ALL) pointerdown → to(파랑/ALL) pointerup ──
        const hitEditFeature = (e: PointerEvent | MouseEvent, types: string[]): Feature | null => {
            const pixel = olMap.getEventPixel(e);
            const found = olMap.getFeaturesAtPixel(pixel, { hitTolerance: CLICK_TOL })
                .filter(f => types.includes(f.get('_type'))) as Feature[];
            return found[0] ?? null;
        };

        const onConnPointerDown = (e: PointerEvent) => {
            if (e.button !== 0 || phase === 'node') return;
            const f = hitEditFeature(e, ['from', 'fromAll']);
            if (!f) return;
            dragConn = {
                fromLinkId: f.get('_linkId'),
                laneIdx: f.get('_type') === 'fromAll' ? -1 : f.get('_laneIdx') as number,
                anchor: (f.getGeometry() as Point).getCoordinates() as Coordinate,
                moved: false,
                startPx: [e.clientX, e.clientY],
            };
        };

        const onConnPointerMove = (e: PointerEvent) => {
            if (!dragConn) return;
            if (!dragConn.moved) {
                if (Math.hypot(e.clientX - dragConn.startPx[0], e.clientY - dragConn.startPx[1]) < 5) return;
                dragConn.moved = true;
                fromSel = { linkId: dragConn.fromLinkId, laneIdx: dragConn.laneIdx };
                phase = 'lane';
                renderLanePhase(); // src.clear() 포함 → 프리뷰는 아래에서 새로 생성
                dragPreviewFt = null;
            }
            const coord = olMap.getEventCoordinate(e) as Coordinate;
            if (!dragPreviewFt) {
                dragPreviewFt = new Feature(new LineString([dragConn.anchor, coord]));
                dragPreviewFt.setStyle(new Style({
                    stroke: new Stroke({ color: 'rgba(0,220,255,0.9)', width: 2.5, lineDash: [7, 5] }),
                }));
                src.addFeature(dragPreviewFt);
            } else {
                (dragPreviewFt.getGeometry() as LineString).setCoordinates([dragConn.anchor, coord]);
            }
        };

        const onConnPointerUp = (e: PointerEvent) => {
            if (!dragConn) return;
            const wasMoved = dragConn.moved;
            dragConn = null;
            if (dragPreviewFt) { src.removeFeature(dragPreviewFt); dragPreviewFt = null; }
            if (!wasMoved) return; // 이동 없음 → click 이벤트가 선택 토글 처리
            suppressClickUntil = Date.now() + 350;
            const target = hitEditFeature(e, ['to', 'toAll']);
            if (target && fromSel) handleToTarget(target);
            else renderLanePhase(); // 허공에 드롭 → from 선택만 유지
        };

        const blockPointerDown = (e: Event) => e.stopPropagation();
        const vp = olMap.getViewport();
        vp.addEventListener('pointerdown', blockPointerDown, true);
        vp.addEventListener('pointerdown', onConnPointerDown, true);
        vp.addEventListener('pointerup',   blockPointerDown, true);
        vp.addEventListener('pointerup',   onConnPointerUp, true);
        document.addEventListener('pointermove', onConnPointerMove, true);
        vp.addEventListener('click', onClick, true);
        vp.addEventListener('dblclick', blockPointerDown, true);
        vp.addEventListener('contextmenu', blockPointerDown, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            vp.removeEventListener('pointerdown', blockPointerDown, true);
            vp.removeEventListener('pointerdown', onConnPointerDown, true);
            vp.removeEventListener('pointerup',   blockPointerDown, true);
            vp.removeEventListener('pointerup',   onConnPointerUp, true);
            document.removeEventListener('pointermove', onConnPointerMove, true);
            vp.removeEventListener('click', onClick, true);
            vp.removeEventListener('dblclick', blockPointerDown, true);
            vp.removeEventListener('contextmenu', blockPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
            olMap.removeLayer(layer);
            olMap.getTargetElement().style.cursor = '';
            useEditGuideStore.getState().clear();
        };
    }, [olMap, isConnectionActive]);

    // ── Connection 모드: Cesium (2D 전용 모드에선 비활성) ─────────────────────────────────
    useEffect(() => {
        if (NETWORK_EDIT_2D_ONLY) return; // 커넥션 편집도 2D(OL)에서만
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
                    const fromLaneCoord = fromLink.coordinates[fromLink.coordinates.length - 1]!;
                    const toLaneCoord = toLink.coordinates[0]!;
                    // ⚠️ length:0 고정은 NextSim이 셀 개수를 length로 나누는 계산을 하면
                    // division-by-zero/0-size 배열 크래시로 이어질 수 있다 — 실제 거리로 계산.
                    const connLength = getDistance([fromLaneCoord.lng, fromLaneCoord.lat], [toLaneCoord.lng, toLaneCoord.lat]);
                    const newConn: Connection = {
                        featureType: 'connections' as any,
                        id: node.connections.length,
                        fromLink: fromLink.id, fromLane: fromSel.laneIdx,
                        fromLaneCoordinates: fromLaneCoord,
                        toLink: toLink.id, toLane,
                        toLaneCoordinates: toLaneCoord,
                        turning, length: connLength, width: laneWidth,
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
                useNetworkUndoStore.getState().push(network);
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
                useNetworkUndoStore.getState().push(network);
                const updatedNodes = network.nodes.map((n: any) =>
                    String(n.id) === String(selectedNodeId) ? { ...n, connections: [], numConnection: 0 } : n
                );
                const newNetwork: Network = { ...network, nodes: updatedNodes };
                assignPropertyToResponseData(newNetwork as any);
                useNetworkStore.getState().setCurrentJsonData(newNetwork);
                useNetworkStore.getState().setChange(true);
                renderEditPhase();
                const clearedCount = reconcileSignalConnectionIds(newNetwork, [selectedNodeId]);
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `교차로 connection 전체 삭제${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}`,
                });
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
    viewer?: Cesium.Viewer,
) {
    ds.entities.suspendEvents();
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
    ds.entities.resumeEvents();
    if (viewer) try { viewer.scene.requestRender(); } catch (_) {}
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

// ── 링크 쌍 후보 좁히기용 공간 그리드 (broad-phase) ─────────────────
// 실측: 부천 시내처럼 조밀한 구간에 수천 링크가 로드된 상태로 전수비교(O(L²))하면
// 체감 프리징이 생긴다. bbox가 겹치는 링크끼리만 정밀 교차검사를 하도록 좁힌다 —
// bbox 겹침은 실제 교차의 필요조건이라(겹치지 않으면 절대 교차 불가) 정확도 손실 없음.
const GRID_CELL_M = 150; // 대략적 단위(웹메르카토르 "m") — 정확도엔 무관, 버킷 크기만 좌우

type LinkOlCache = { coordsOl: Coordinate[]; bbox: [number, number, number, number] };

function buildLinkOlCache(links: Link[]): LinkOlCache[] {
    return links.map(link => {
        const coordsOl = link.coordinates.map(c => fromLonLat([c.lng, c.lat]));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of coordsOl) {
            if (x! < minX) minX = x!; if (x! > maxX) maxX = x!;
            if (y! < minY) minY = y!; if (y! > maxY) maxY = y!;
        }
        return { coordsOl, bbox: [minX, minY, maxX, maxY] };
    });
}

function bboxOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** bbox가 겹칠 가능성이 있는 링크 인덱스 쌍(i<j)만 골라 반환 (그리드 버킷 기반 broad-phase) */
function findCandidateLinkPairs(cache: LinkOlCache[]): Array<[number, number]> {
    const cellMap = new Map<string, number[]>();
    for (let idx = 0; idx < cache.length; idx++) {
        const [minX, minY, maxX, maxY] = cache[idx]!.bbox;
        const cx0 = Math.floor(minX / GRID_CELL_M), cx1 = Math.floor(maxX / GRID_CELL_M);
        const cy0 = Math.floor(minY / GRID_CELL_M), cy1 = Math.floor(maxY / GRID_CELL_M);
        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
                const key = `${cx}_${cy}`;
                let bucket = cellMap.get(key);
                if (!bucket) { bucket = []; cellMap.set(key, bucket); }
                bucket.push(idx);
            }
        }
    }

    const tried = new Set<string>();
    const pairs: Array<[number, number]> = [];
    for (const bucket of cellMap.values()) {
        for (let a = 0; a < bucket.length; a++) {
            for (let b = a + 1; b < bucket.length; b++) {
                const i = Math.min(bucket[a]!, bucket[b]!);
                const j = Math.max(bucket[a]!, bucket[b]!);
                const key = `${i}_${j}`;
                if (tried.has(key)) continue;
                tried.add(key);
                if (!bboxOverlap(cache[i]!.bbox, cache[j]!.bbox)) continue;
                pairs.push([i, j]);
            }
        }
    }
    return pairs;
}

// ── 기하학적 교차 감지 → Link 분할 → 교차로 자동 생성 ─────────────
// 반환값: { created: 새로 생성된 교차로 노드 수, signalsCleared: 커넥션 재생성으로 참조 초기화된 신호 수 }
export function detectAndSplitIntersections(): { created: number; signalsCleared: number } {
    let network = useNetworkStore.getState().currentJsonData;
    if (!network) return { created: 0, signalsCleared: 0 };

    let created = 0;
    let ts = Date.now() + 5000; // finishSegment ts와 충돌 방지

    // 교차 감지는 반복적으로: 한 번 분할 후 링크 목록이 바뀌므로 재시도.
    // 매 재시도마다 그리드를 다시 짓는 비용은 O(L)이라, 기존 O(L²) 전수비교보다 훨씬 싸다.
    let changed = true;
    while (changed) {
        changed = false;
        const links = network.links;
        const cache = buildLinkOlCache(links);
        const candidatePairs = findCandidateLinkPairs(cache);

        outer:
        for (const [i, j] of candidatePairs) {
            const linkA = links[i]!, linkB = links[j]!;

            // 같은 fromNode / toNode 를 공유하면 이미 연결됨 → 스킵
            if (String(linkA.fromNode) === String(linkB.fromNode) ||
                String(linkA.fromNode) === String(linkB.toNode) ||
                String(linkA.toNode)   === String(linkB.fromNode) ||
                String(linkA.toNode)   === String(linkB.toNode)) continue;

            const aCoordsOl = cache[i]!.coordsOl;
            const bCoordsOl = cache[j]!.coordsOl;

            for (let si = 0; si < aCoordsOl.length - 1; si++) {
                const a1 = aCoordsOl[si]!, a2 = aCoordsOl[si + 1]!;

                for (let sj = 0; sj < bCoordsOl.length - 1; sj++) {
                    const b1 = bCoordsOl[sj]!, b2 = bCoordsOl[sj + 1]!;

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

    let signalsCleared = 0;
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
        const before = useNetworkStore.getState().currentJsonData!;
        useNetworkUndoStore.getState().push(before);
        useNetworkStore.getState().setCurrentJsonData(network);
        useNetworkStore.getState().setChange(true);
        // 분할로 사라진 원본 링크/병합된 노드 — 타일 모드 MVT 마스킹·동기화 제외
        markRemovedForTileMask(before, network);
        // 재생성으로 커넥션 id가 바뀌어 무효해진 신호 connectionId 정리 — 네트워크 전역에 영향을 주는 작업이라 특히 중요
        signalsCleared = reconcileSignalConnectionIds(network, intersectionNodes.map(n => n.id));
    }

    return { created, signalsCleared };
}

// ── 기존 노드 기반 connection 일괄 재생성 (링크는 이미 끊어진 경우) ──
// 반환값: { count: 재생성된 교차로 노드 수, signalsCleared: 참조 초기화된 신호 수 }
export function autoGenerateAllIntersections(): { count: number; signalsCleared: number } {
    const network = useNetworkStore.getState().currentJsonData;
    if (!network) return { count: 0, signalsCleared: 0 };

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
    useNetworkUndoStore.getState().push(network);
    useNetworkStore.getState().setCurrentJsonData(result);
    useNetworkStore.getState().setChange(true);
    const signalsCleared = reconcileSignalConnectionIds(result, intersectionNodes.map(n => n.id));

    return { count: intersectionNodes.length, signalsCleared };
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
            const connTurning = normalizeTurning(conn.turning);
            const color  = TURN_FLASH_OL[connTurning] ?? 'rgba(160,160,160,0.8)';
            const dx = toOl[0]! - fromOl[0]!; const dy = toOl[1]! - fromOl[1]!;
            const angle = Math.atan2(dy, dx);

            const lineF = new Feature(new LineString(connCurveOl(fromOl, nodeOl, toOl, connTurning)));
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
