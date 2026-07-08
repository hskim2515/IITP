import { getDistance } from "ol/sphere";
import { fromLonLat, toLonLat } from "ol/proj";
import type { Link, Node } from "@type/Network";

/**
 * 네이버 로드뷰를 네트워크 링크(polyline) 위로 스내핑 + 링크 따라 이동하기 위한 순수 함수 모음.
 * 파노라마·React 비의존 → 단위 테스트 가능. 좌표는 WGS84(lng/lat)로 입출력하되, 거리·사영
 * 계산은 EPSG:3857 로 변환해 유클리드로 처리(짧은 거리라 왜곡 무시 가능).
 */

/** 링크 polyline 위의 한 점 (스냅 결과 / 이동 상태). */
export interface OnLink {
    linkId: string;
    segIndex: number; // coordinates[segIndex] ~ coordinates[segIndex+1] 사이
    t: number;        // 세그먼트 내 위치 (0~1)
    lng: number;
    lat: number;
}

/** nodeId → 인접 링크들 (fromNode/toNode 로 연결). */
export function buildAdjacency(links: Link[]): Map<string, Link[]> {
    const adj = new Map<string, Link[]>();
    const push = (nodeId: string | number | undefined, link: Link) => {
        if (nodeId == null) return;
        const k = String(nodeId);
        const arr = adj.get(k);
        if (arr) arr.push(link); else adj.set(k, [link]);
    };
    for (const link of links) {
        push(link.fromNode, link);
        push(link.toNode, link);
    }
    return adj;
}

/** 두 점(WGS84)의 방위각 0~360 (북=0, 시계방향). pov.pan 과 비교용. */
export function bearing(from: { lng: number; lat: number }, to: { lng: number; lat: number }): number {
    const φ1 = (from.lat * Math.PI) / 180;
    const φ2 = (to.lat * Math.PI) / 180;
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return ((θ * 180) / Math.PI + 360) % 360;
}

/** 두 각도(도)의 최소 차이 0~180. */
function angleDiff(a: number, b: number): number {
    const d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
}

/** 점 p 를 선분 a-b 에 사영한 최근접점 + t(0~1). 좌표는 3857(유클리드). */
function projectPointToSegment(
    px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number; t: number } {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { x: ax, y: ay, t: 0 };
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + t * dx, y: ay + t * dy, t };
}

/** 링크 coordinates 를 3857 점 배열로 변환 (캐시 없이 매번; 뷰포트 규모라 허용). */
function linkTo3857(link: Link): [number, number][] {
    return (link.coordinates ?? []).map((c) => fromLonLat([c.lng, c.lat]) as [number, number]);
}

/**
 * (lng,lat) 에서 모든 링크 polyline 위 가장 가까운 점을 찾는다. maxMeters 밖이면 null.
 */
export function snapToLinks(
    links: Link[], lng: number, lat: number, maxMeters: number,
): OnLink | null {
    const p = fromLonLat([lng, lat]);
    const px = p[0] ?? 0, py = p[1] ?? 0;
    let best: OnLink | null = null;
    let bestDistM = Infinity;
    for (const link of links) {
        const pts = linkTo3857(link);
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (!a || !b) continue;
            const proj = projectPointToSegment(px, py, a[0], a[1], b[0], b[1]);
            const s = toLonLat([proj.x, proj.y]);
            const slng = s[0] ?? 0, slat = s[1] ?? 0;
            const distM = getDistance([lng, lat], [slng, slat]);
            if (distM < bestDistM) {
                bestDistM = distM;
                best = { linkId: String(link.id), segIndex: i, t: proj.t, lng: slng, lat: slat };
            }
        }
    }
    if (!best || bestDistM > maxMeters) return null;
    return best;
}

/** OnLink 의 lng/lat 를 링크 좌표에서 재계산 (segIndex/t 기준). */
function onLinkCoord(link: Link, segIndex: number, t: number): { lng: number; lat: number } {
    const c = link.coordinates;
    const a = c[segIndex] ?? c[0];
    const b = c[segIndex + 1] ?? a;
    if (!a || !b) return { lng: 0, lat: 0 };
    return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
}

/** 링크의 진행 방향 끝 노드 id (forward=true: toNode 방향). */
function endNodeId(link: Link, forward: boolean): string {
    return String(forward ? link.toNode : link.fromNode);
}

/**
 * 현재 선 위 점에서 링크를 따라 meters(음수=후진) 만큼 이동. 링크 끝(노드) 넘어가면 인접
 * 링크 중 headingPan 과 가장 정렬된 링크로 이어간다. 새 OnLink 반환(불가 시 기존 반환).
 *
 * @param headingPan pov.pan(도). Infinity/NaN 이면 교차로에서 "왔던 링크 제외 첫 링크"로 폴백.
 */
export function advanceAlongLink(
    onLink: OnLink,
    linkIndex: Map<string, Link>,
    adjacency: Map<string, Link[]>,
    meters: number,
    headingPan: number,
): OnLink {
    let link = linkIndex.get(onLink.linkId);
    if (!link) return onLink;

    // 현재 세그먼트 상 남은 이동을 누적 처리. 세그먼트 길이(m)로 t 를 전진.
    let segIndex = onLink.segIndex;
    let t = onLink.t;
    let remaining = meters;
    const forward = meters >= 0;
    let guard = 0;

    while (guard++ < 200) {
        const c = link.coordinates;
        // 현재 세그먼트 끝점 방향으로 남은 거리 계산
        const aIdx = forward ? segIndex : segIndex + 1;
        const bIdx = forward ? segIndex + 1 : segIndex;
        const a = c[aIdx], b = c[bIdx];
        if (!a || !b) break;
        const segLen = getDistance([a.lng, a.lat], [b.lng, b.lat]) || 1;
        // 현재 t 에서 진행 방향 끝까지 남은 비율
        const tToEnd = forward ? (1 - t) : t;
        const distToEnd = tToEnd * segLen;

        if (Math.abs(remaining) <= distToEnd) {
            // 이 세그먼트 안에서 끝남
            const dt = remaining / segLen; // forward: +, backward: -
            t = t + dt;
            const coord = onLinkCoord(link, segIndex, Math.max(0, Math.min(1, t)));
            return { linkId: String(link.id), segIndex, t: Math.max(0, Math.min(1, t)), ...coord };
        }

        // 세그먼트 소진 → 다음 세그먼트 또는 다음 링크
        remaining = remaining - (forward ? distToEnd : -distToEnd);
        const nextSeg = forward ? segIndex + 1 : segIndex - 1;
        if (nextSeg >= 0 && nextSeg < c.length - 1) {
            segIndex = nextSeg;
            t = forward ? 0 : 1;
            continue;
        }

        // 링크 끝(노드) 도달 → 인접 링크로 이어감
        const nodeId = endNodeId(link, forward);
        const endCoord = c[forward ? c.length - 1 : 0];
        if (!endCoord) break;
        const node = { lng: endCoord.lng, lat: endCoord.lat };
        const curLinkId = String(link.id);
        const cands = (adjacency.get(nodeId) ?? []).filter((l) => String(l.id) !== curLinkId);
        if (cands.length === 0) {
            // 막다른 길: 끝점에 정지
            return { linkId: String(link.id), segIndex: forward ? c.length - 2 : 0, t: forward ? 1 : 0, lng: endCoord.lng, lat: endCoord.lat };
        }
        // 다음 링크: headingPan 과 가장 정렬된 것 선택 (노드에서 링크 반대끝 방향의 bearing)
        const pick = pickAlignedLink(cands, nodeId, node, headingPan);
        link = pick.link;
        // 새 링크에서 nodeId 가 fromNode 면 forward(0→) 로 진입, toNode 면 backward 진입
        const enterForward = String(link.fromNode) === nodeId;
        segIndex = enterForward ? 0 : link.coordinates.length - 2;
        t = enterForward ? 0 : 1;
        // forward 방향 재설정: 진입 방향에 맞춰 remaining 부호 유지(이미 절대량으로 감소 중)
        // enterForward 면 이후 forward=true 로 진행해야 하나, 이 루프는 상단 forward 상수 사용.
        // 간결화를 위해 방향 전환 시 재귀 호출.
        return advanceAlongLink(
            { linkId: String(link.id), segIndex, t, lng: node.lng, lat: node.lat },
            linkIndex, adjacency,
            enterForward ? Math.abs(remaining) : -Math.abs(remaining),
            headingPan,
        );
    }
    return onLink;
}

/** 노드에서 뻗는 후보 링크 중 headingPan 과 가장 정렬된 링크 선택. */
function pickAlignedLink(
    cands: Link[], nodeId: string, node: { lng: number; lat: number }, headingPan: number,
): { link: Link } {
    let best = cands[0]!;
    if (!Number.isFinite(headingPan)) return { link: best };
    let bestDiff = Infinity;
    for (const l of cands) {
        // 노드에서 링크 반대편 끝으로의 방향
        const far = String(l.fromNode) === nodeId
            ? l.coordinates[l.coordinates.length - 1]
            : l.coordinates[0];
        if (!far) continue;
        const brg = bearing(node, { lng: far.lng, lat: far.lat });
        const diff = angleDiff(brg, headingPan);
        if (diff < bestDiff) { bestDiff = diff; best = l; }
    }
    return { link: best };
}

/** linkId → Link 인덱스. */
export function buildLinkIndex(links: Link[]): Map<string, Link> {
    const m = new Map<string, Link>();
    for (const l of links) m.set(String(l.id), l);
    return m;
}

/** (미사용 대비) 노드 좌표 조회 헬퍼. */
export function nodeCoord(node: Node): { lng: number; lat: number } {
    return { lng: node.coordinates.lng, lat: node.coordinates.lat };
}
