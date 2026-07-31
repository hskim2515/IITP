import { getNetworkForDummyGeneration } from "@utils/generationNetwork";
import { useSignalStore } from "@stores/useSignalStore";
import { useSignalTodStore } from "@stores/useSignalTodStore";
import { getActiveVersionId } from "@utils/versionId";
import axiosInstance from "@api/axiosInstance";
import { validateSignalPlans, validateTodDataAgainstSignals } from "@utils/signalEditorUtils";

/**
 * 시설물 메뉴 키 중 NextSim 실행에 필수인 항목 — layer.sql facility 그룹 기준
 * network.xml/mode.xml ← network, signal.xml ← signal.
 * (odmatrix.xml/scenario.xml/signalTOD.xml 은 시설물 메뉴가 아닌 별도 패널에서 관리됨)
 *
 * odIdBands/signalTod는 시설물 메뉴 항목은 아니지만(odmatrix.xml/signalTOD.xml은 별도
 * 패널), 둘 다 NextSim이 실제로 크래시하는 확인된 원인이라 여기 포함한다:
 * - odIdBands: 터미널/일반 노드 id 대역 불일치(OD가 참조하는 노드에 한해서만 문제됨 —
 *   OdTerminalIdBandService 참고)
 * - signalTod: signal.xml에 실제 플랜(planList)이 있는 노드가 signalTOD.xml에는
 *   빠져있는 경우(NextSimInputScaffolder.signalTodValid 참고 — scenario1_2에서
 *   std::out_of_range로 실제 재현된 크래시)
 * 백엔드가 임포트/네트워크 편집 시점에 이를 보정/스캐폴딩하지만(NextSimInputScaffolder,
 * OdTerminalIdBandService), 대형 네트워크의 스트리밍 diff 경로는 이 보정을 건너뛰고,
 * 신호/TOD를 수동으로 직접 편집한 경우도 이 자동 보정을 안 거치므로 헤더의 "전체 검증"이
 * 마지막 안전망 역할을 한다.
 */
export const NEXTSIM_REQUIRED_KEYS = new Set(["network", "signal", "signalTod", "odIdBands"]);

/** 시설물 스키마 라벨과 별개로, 헤더 등 스키마에 접근하지 않는 전역 UI에서 쓰는 고정 라벨 */
export const NEXTSIM_REQUIRED_LABELS: Record<string, string> = {
    network: "도로",
    signal: "신호등",
    signalTod: "신호 TOD",
    odIdBands: "OD 노드 ID",
};

export interface FacilityValidationResult {
    ok: boolean;
    issues: string[];
}

function validateNetworkStructure(network: any): FacilityValidationResult {
    const nodes = (network?.nodes ?? []).filter(Boolean);
    const links = (network?.links ?? []).filter(Boolean);

    if (nodes.length === 0 || links.length === 0) {
        return { ok: false, issues: ["네트워크에 노드 또는 링크가 없습니다."] };
    }

    const nodeIds = new Set(nodes.map((n: any) => String(n.id)));
    const linkIds = new Set(links.map((l: any) => String(l.id)));

    let orphanLinks = 0;
    for (const link of links) {
        if (!nodeIds.has(String(link.fromNode)) || !nodeIds.has(String(link.toNode))) orphanLinks++;
    }

    let badConn = 0;
    for (const node of nodes) {
        for (const conn of (node.connections ?? []).filter(Boolean)) {
            if (!linkIds.has(String(conn.fromLink)) || !linkIds.has(String(conn.toLink))) badConn++;
        }
    }

    const issues: string[] = [];
    if (orphanLinks > 0) issues.push(`시작/끝 노드가 존재하지 않는 링크 ${orphanLinks}건`);
    if (badConn > 0) issues.push(`존재하지 않는 링크를 참조하는 커넥션 ${badConn}건`);

    return { ok: issues.length === 0, issues };
}

function validateSignalAgainstNetwork(network: any): FacilityValidationResult {
    const signalData = useSignalStore.getState().currentJsonData as any;
    const signals = (signalData?.signals ?? []).filter(Boolean);
    // NextSim은 signal.xml이 없으면 빈 템플릿을 만들어 실행 자체는 진행하지만,
    // 신호 데이터가 하나도 없는 채로 돌리면 교차로 제어 없이 시뮬레이션되어
    // 결과가 무의미해질 수 있다 — 무결성 검사에서는 실패로 처리해 사용자가 인지하게 한다.
    if (signals.length === 0) {
        return { ok: false, issues: ["신호 데이터가 없습니다."] };
    }

    const nodes = (network?.nodes ?? []).filter(Boolean);
    const nodeIds = new Set(nodes.map((n: any) => String(n.id)));
    const connIdsByNode = new Map<string, Set<string>>();
    for (const node of nodes) {
        connIdsByNode.set(String(node.id), new Set((node.connections ?? []).filter(Boolean).map((c: any) => String(c.id))));
    }

    let badNode = 0;
    let badConn = 0;
    for (const sig of signals) {
        const nodeId = String(sig.nodeId);
        if (!nodeIds.has(nodeId)) { badNode++; continue; }
        if (sig.connectionId != null && !connIdsByNode.get(nodeId)?.has(String(sig.connectionId))) badConn++;
    }

    const issues: string[] = [];
    if (badNode > 0) issues.push(`네트워크에 없는 노드를 참조하는 신호 ${badNode}건 (네트워크 재가져오기로 노드 id가 바뀌었을 수 있습니다)`);
    if (badConn > 0) issues.push(`존재하지 않는 커넥션을 참조하는 신호 ${badConn}건`);
    issues.push(...validateSignalPlansAgainstSignals(signals).issues);

    return { ok: issues.length === 0, issues };
}

/** 교차로별 Signal Plan/Phase 구조와 Turn 참조가 저장 가능한 상태인지 검사한다. */
export function validateSignalPlansAgainstSignals(
    sourceSignals?: any[],
): FacilityValidationResult {
    const signalData = useSignalStore.getState().currentJsonData as any;
    const signals = (sourceSignals ?? signalData?.signals ?? []).filter(Boolean);
    const byNode = new Map<string, any[]>();
    for (const signal of signals) {
        const nodeId = String(signal?.nodeId ?? "");
        if (!nodeId) continue;
        if (!byNode.has(nodeId)) byNode.set(nodeId, []);
        byNode.get(nodeId)!.push(signal);
    }

    const issues: string[] = [];
    for (const [nodeId, nodeSignals] of byNode) {
        const turnIds = Array.from(new Set(
            nodeSignals
                .map(signal => signal?.turnId)
                .filter((turnId: unknown) => turnId != null)
                .map(String),
        ));
        const planHolder = nodeSignals.find(signal => Array.isArray(signal?.plans));
        const plans = planHolder?.plans ?? [];
        if (plans.length === 0) {
            issues.push(`교차로 #${nodeId}: Signal Plan이 없습니다.`);
            continue;
        }
        for (const issue of validateSignalPlans(plans, turnIds)) {
            issues.push(`교차로 #${nodeId}: ${issue.message}`);
        }
    }
    return { ok: issues.length === 0, issues };
}

/**
 * signal.xml에 실제 플랜(planList)을 가진 노드가 signalTOD.xml에도 전부 있는지 검증한다.
 *
 * <p>실측 확인된 크래시(scenario1_2, NextSimInputScaffolder.signalTodValid 문서 참고):
 * signal.xml은 여러 노드에 실제 turnList/planList를 갖고 있는데 signalTOD.xml은 노드가
 * 하나도 없는 완전 공백이었고, 이 불일치가 NextSim을 std::out_of_range로 크래시시켰다
 * (route-generator가 아니라 nextsim 자체의 별도 크래시 원인 — "존재하기만 하면 통과"인
 * 검사로는 못 잡음, TOD가 실제로 그 노드들을 커버하는지까지 봐야 함).
 */
export function validateSignalTodAgainstSignal(): FacilityValidationResult {
    const signalData = useSignalStore.getState().currentJsonData as any;
    const signals = (signalData?.signals ?? []).filter(Boolean);
    const todData = useSignalTodStore.getState().currentJsonData as any;
    const issues = validateTodDataAgainstSignals(signals, (todData?.nodes ?? []).filter(Boolean));
    return { ok: issues.length === 0, issues };
}

// Network ID naming 스펙 대역 — OdTerminalIdBandService/NetworkIdNormalizer(백엔드)와 동일 기준.
const TERMINAL_BAND_START = 11_000_000, TERMINAL_BAND_END = 12_000_000;
const NORMAL_BAND_START = 10_000_000, NORMAL_BAND_END = 11_000_000;

/**
 * OD 매트릭스가 참조하는 노드의 id 대역이 실제 연결 수(degree)와 맞는지 검증한다.
 *
 * <p>확인된 크래시 원인(OdTerminalIdBandService 문서 참고): NextSim route-generator는
 * 터미널(degree≤1) 노드와 일반(degree&gt;1) 노드가 같은 id 대역(10xxxxxx/11xxxxxx)을
 * 공유하면 std::out_of_range로 크래시한다. 이 대역 정합성이 실제로 문제되는 범위는
 * OD가 source/sink로 참조하는 노드로 정확히 좁혀진다(OD 미참조 터미널은 NextSimRunner가
 * garage로 강등해 크래시 유발 계산에서 제외됨 — nextsim.prune-unused-terminals).
 *
 * <p>백엔드가 네트워크 편집 저장 시점마다 이 대역을 자동 보정하지만(NetworkController →
 * OdTerminalIdBandService.reconcileAfterNetworkEdit), 대형 네트워크는 스트리밍 diff
 * 경로를 타면서 이 보정을 건너뛴다 — 이 검증이 실행 전 마지막 안전망이다.
 */
async function validateOdReferencedNodeIdBands(network: any): Promise<FacilityValidationResult> {
    const versionId = getActiveVersionId();
    if (!versionId) return { ok: true, issues: [] };

    let odData: any = null;
    try {
        const res = await axiosInstance.get(`/od-matrix/${versionId}`);
        odData = res.data;
    } catch (e: any) {
        if (e?.response?.status === 404) {
            // OD 매트릭스가 아직 없음 — NextSim이 빈 상태로도 실행은 시도하므로 검증 대상 없음
            return { ok: true, issues: [] };
        }
        // 그 외(서버 오류/네트워크 문제)는 확인 자체가 안 된 것 — 안전망 취지상 통과시키지 않는다
        return { ok: false, issues: ["OD 매트릭스 확인 중 오류가 발생했습니다 — 다시 시도하세요."] };
    }

    const referencedIds = new Set<string>();
    for (const item of odData?.odMatrices ?? []) {
        // 서버 원본 구조는 nvodMatrix.demands 로 중첩됨(OdMatrixModal.tsx와 동일 매핑 규약)
        for (const d of item?.nvodMatrix?.demands ?? []) {
            if (d?.source != null) referencedIds.add(String(d.source));
            if (d?.sink != null) referencedIds.add(String(d.sink));
        }
    }
    if (referencedIds.size === 0) return { ok: true, issues: [] };

    const nodes = (network?.nodes ?? []).filter(Boolean);
    const nodeIds = new Set(nodes.map((n: any) => String(n.id)));

    const degreeByNode = new Map<string, number>();
    for (const link of (network?.links ?? []).filter(Boolean)) {
        const from = String(link.fromNode);
        const to = String(link.toNode);
        degreeByNode.set(from, (degreeByNode.get(from) ?? 0) + 1);
        degreeByNode.set(to, (degreeByNode.get(to) ?? 0) + 1);
    }

    let dangling = 0;
    const mismatched: string[] = [];
    for (const idStr of referencedIds) {
        if (!nodeIds.has(idStr)) { dangling++; continue; }
        const id = Number(idStr);
        if (!Number.isFinite(id)) continue;
        const degree = degreeByNode.get(idStr) ?? 0;
        const shouldBeTerminalBand = degree <= 1;
        const inTerminalBand = id >= TERMINAL_BAND_START && id < TERMINAL_BAND_END;
        const inNormalBand = id >= NORMAL_BAND_START && id < NORMAL_BAND_END;
        if (shouldBeTerminalBand ? !inTerminalBand : !inNormalBand) mismatched.push(idStr);
    }

    const issues: string[] = [];
    if (dangling > 0) {
        issues.push(`OD 매트릭스가 존재하지 않는 노드를 참조 ${dangling}건 (네트워크 편집/재가져오기로 id가 바뀌었을 수 있습니다)`);
    }
    if (mismatched.length > 0) {
        const preview = mismatched.slice(0, 5).join(', ') + (mismatched.length > 5 ? ' 외' : '');
        issues.push(`NextSim 크래시 위험 — id 대역이 실제 연결 수와 맞지 않는 노드 ${mismatched.length}건: ${preview}`);
    }

    return { ok: issues.length === 0, issues };
}

/**
 * network/signal/signalTod/odIdBands 필수 항목을 한 번에 검증한다. 전체 네트워크는 무거운
 * fetch(타일 모드에서도 전체 다운로드)이므로 네 검증이 각자 다시 받지 않도록 한 번만 받아 공유한다.
 */
export async function validateAllRequired(): Promise<Record<string, FacilityValidationResult>> {
    const network = await getNetworkForDummyGeneration();
    return {
        network: validateNetworkStructure(network),
        signal: validateSignalAgainstNetwork(network),
        signalTod: validateSignalTodAgainstSignal(),
        odIdBands: await validateOdReferencedNodeIdBands(network),
    };
}
