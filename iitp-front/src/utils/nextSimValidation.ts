import { getNetworkForDummyGeneration } from "@utils/generationNetwork";
import { useSignalStore } from "@stores/useSignalStore";

/**
 * 시설물 메뉴 키 중 NextSim 실행에 필수인 항목 — layer.sql facility 그룹 기준
 * network.xml/mode.xml ← network, signal.xml ← signal.
 * (odmatrix.xml/scenario.xml/signalTOD.xml 은 시설물 메뉴가 아닌 별도 패널에서 관리됨)
 */
export const NEXTSIM_REQUIRED_KEYS = new Set(["network", "signal"]);

export interface FacilityValidationResult {
    ok: boolean;
    issues: string[];
}

async function loadNetworkForValidation(): Promise<any | null> {
    return getNetworkForDummyGeneration();
}

export async function validateNetworkIntegrity(): Promise<FacilityValidationResult> {
    const network = await loadNetworkForValidation();
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

export async function validateSignalIntegrity(): Promise<FacilityValidationResult> {
    const signalData = useSignalStore.getState().currentJsonData as any;
    const signals = (signalData?.signals ?? []).filter(Boolean);
    // 빈 신호(signal.xml 빈 템플릿)는 NextSim 이 허용하는 유효 상태
    if (signals.length === 0) return { ok: true, issues: [] };

    const network = await loadNetworkForValidation();
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

    return { ok: issues.length === 0, issues };
}

export async function validateFacilityIntegrity(key: string): Promise<FacilityValidationResult> {
    switch (key) {
        case "network": return validateNetworkIntegrity();
        case "signal": return validateSignalIntegrity();
        default: return { ok: true, issues: [] };
    }
}
