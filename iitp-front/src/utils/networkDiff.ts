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

/**
 * 네트워크 diff 저장 (타일 모드 인지, 단일 진입점).
 *
 * ⚠️ 타일 모드에서 전체 저장(POST /network/{v})은 **절대 금지** — currentJsonData 가
 * viewport 일부라 전국 데이터를 덮어쓴다. 이 함수만이 안전한 저장 경로이며,
 * 실패 시에도 전체 저장으로 폴백하지 말 것.
 *
 * 삭제 id 소스 (합집합):
 *  - store.deletedRecords: 그리드/removeRecordsByGuid 경로 삭제
 *  - useNetworkEditStore.deletedLink/NodeIds: 편집 도구(Delete키·분할·병합·우클릭) 삭제 —
 *    applyNetworkUpdate 직접 경로라 deletedRecords 에 안 쌓임 (누락되면 삭제가 서버에 미반영)
 *
 * @returns 'saved' 전송 성공 · 'empty' 변경 없음(성공 취급) · 'skipped' 적용 불가(비타일에서 origin 없음 등)
 */
export async function saveNetworkDiffTileAware(versionKey: string): Promise<'saved' | 'empty' | 'skipped'> {
    // 순환 의존 회피(utils→stores 단방향 유지)를 위해 지연 import
    const { useNetworkStore } = await import('@stores/useNetworkStore');
    const { useNetworkEditStore } = await import('@stores/useNetworkEditStore');
    const { NETWORK_TILING } = await import('@utils/lodConstants');
    const { useNetworkTileStore } = await import('@stores/useNetworkTileStore');
    const { default: axiosInstance } = await import('@api/axiosInstance');

    const store = useNetworkStore.getState() as any;
    const current = store.currentJsonData as Network | undefined;
    if (!current) return 'skipped';

    const tileMode = NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode;
    let diff: NetworkDiff;
    if (tileMode) {
        // viewport 링크/노드 전부 upsert (미편집분도 동일값 교체라 무해) + 삭제 id 합집합
        const deletedRecords: any[] = store.deletedRecords ?? [];
        const edit = useNetworkEditStore.getState();
        const delLinks = new Set<string>([...edit.deletedLinkIds]);
        const delNodes = new Set<string>([...edit.deletedNodeIds]);
        for (const r of deletedRecords) {
            if (r?.id == null) continue;
            if (r.featureType === 'links') delLinks.add(String(r.id));
            if (r.featureType === 'nodes') delNodes.add(String(r.id));
        }
        diff = {
            upsertLinks: current.links ?? [],
            upsertNodes: current.nodes ?? [],
            deleteLinkIds: [...delLinks],
            deleteNodeIds: [...delNodes],
        };
    } else {
        const origin = store.originData as Network | undefined;
        if (!origin) return 'skipped';
        diff = computeNetworkDiff(origin, current);
    }
    if (isNetworkDiffEmpty(diff)) return 'empty';

    // "새 버전으로 저장": 대상 versionKey 에는 network.xml 이 아직 없다 →
    // 편집 중이던 기준 버전(activeVersionId)을 baseVersionId 로 보내 서버가
    // 기준에서 로드 + diff 적용 + 대상으로 저장하게 한다.
    const { getActiveVersionId } = await import('@utils/versionId');
    const activeId = getActiveVersionId();
    const payload = (activeId && String(activeId) !== String(versionKey))
        ? { ...diff, baseVersionId: String(activeId) }
        : diff;

    const res = await axiosInstance({ method: 'POST', url: `/network/${versionKey}/diff`, data: payload });
    store.clearDeletedRecords?.();
    // setChange(false) → isChanged true→false 구독(onEditsCleared)이 편집 마스킹 정리 + MVT 재fetch
    store.setChange(false);

    // 수동 편집으로 새로 그린 노드/링크는 프론트 임시 id(Date.now())를 들고 있었는데,
    // 백엔드가 저장 시점에 Network ID naming 규칙(8자리 Link/Node/Terminal)으로 재채번했을
    // 수 있다(NetworkIdNormalizer, 신규 요소만). odNodeIdRemap은 OD 매트릭스가 이미 참조
    // 중이던 기존 노드가 이번 편집으로 degree 드리프트를 일으켜 대역이 재조정된 경우
    // (OdTerminalIdBandService — 그 외 기존 노드는 절대 안 바뀜). 프론트가 들고 있던 id는
    // 이제 stale이므로 로컬에서 직접 교체하는 대신 뷰포트를 서버 authoritative 데이터로
    // 다시 받아온다.
    const linkIdRemap = res?.data?.linkIdRemap;
    const nodeIdRemap = res?.data?.nodeIdRemap;
    const odNodeIdRemap = res?.data?.odNodeIdRemap;
    const hasRemap = (linkIdRemap && Object.keys(linkIdRemap).length > 0)
        || (nodeIdRemap && Object.keys(nodeIdRemap).length > 0)
        || (odNodeIdRemap && Object.keys(odNodeIdRemap).length > 0);
    if (hasRemap) {
        const { refreshNetworkTiles } = await import('@utils/networkRefresh');
        refreshNetworkTiles();
    }
    return 'saved';
}
