import type { Network, Link, Node } from "@type/Network";

/**
 * 도메인 id 기반 네트워크 diff (단계 4-1).
 *
 * <p>경로 기반 __guid 에 의존하지 않고, 서버 원본(originData) 과 편집본(currentJsonData) 을
 * **링크 id / 노드 id** 로 직접 비교해 변경 집합을 만든다. 식별체계와 무관하므로 향후
 * 식별자 마이그레이션(경로→id)·타일 모드 편집에서도 그대로 재사용된다.
 *
 * <p>전체 네트워크를 통째로 보내는 대신 변경분만 전송 → 저장 payload 가 viewport 규모로 축소.
 */
export interface NetworkDiff {
    upsertLinks: Link[];
    upsertNodes: Node[];
    deleteLinkIds: (number | string)[];
    deleteNodeIds: (number | string)[];
}

/** diff 비교 시 제외할 클라이언트 메타 필드 (서버로 보낼 필요 없음 / 비교 노이즈) */
const META_KEYS = new Set(["__guid", "featureType"]);

/** 메타 필드를 제외한 안정적 JSON 직렬화 (키 정렬 → 순서 무관 비교) */
function stableStringify(obj: any): string {
    return JSON.stringify(obj, (key, value) => {
        if (META_KEYS.has(key)) return undefined;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            // 키 정렬로 안정화
            const sorted: Record<string, any> = {};
            for (const k of Object.keys(value).sort()) sorted[k] = value[k];
            return sorted;
        }
        return value;
    });
}

function indexById<T extends { id: number | string }>(arr: T[] | undefined): Map<string, T> {
    const m = new Map<string, T>();
    for (const item of arr ?? []) {
        if (item?.id != null) m.set(String(item.id), item);
    }
    return m;
}

/**
 * origin → current 변경 집합 계산.
 * - current 에만 있는 id → 추가(upsert)
 * - 양쪽에 있으나 내용이 다른 id → 수정(upsert)
 * - origin 에만 있는 id → 삭제
 */
export function computeNetworkDiff(origin: Network | undefined, current: Network | undefined): NetworkDiff {
    const diff: NetworkDiff = { upsertLinks: [], upsertNodes: [], deleteLinkIds: [], deleteNodeIds: [] };
    if (!current) return diff;

    // ── 링크 ──
    const oLinks = indexById<Link>(origin?.links);
    const cLinks = indexById<Link>(current.links);
    for (const [id, link] of cLinks) {
        const o = oLinks.get(id);
        if (!o || stableStringify(o) !== stableStringify(link)) diff.upsertLinks.push(link);
    }
    for (const id of oLinks.keys()) {
        if (!cLinks.has(id)) diff.deleteLinkIds.push(id);
    }

    // ── 노드 ──
    const oNodes = indexById<Node>(origin?.nodes);
    const cNodes = indexById<Node>(current.nodes);
    for (const [id, node] of cNodes) {
        const o = oNodes.get(id);
        if (!o || stableStringify(o) !== stableStringify(node)) diff.upsertNodes.push(node);
    }
    for (const id of oNodes.keys()) {
        if (!cNodes.has(id)) diff.deleteNodeIds.push(id);
    }

    return diff;
}

/** diff 가 비어있는지 (저장할 변경 없음) */
export function isNetworkDiffEmpty(d: NetworkDiff): boolean {
    return d.upsertLinks.length === 0 && d.upsertNodes.length === 0
        && d.deleteLinkIds.length === 0 && d.deleteNodeIds.length === 0;
}
