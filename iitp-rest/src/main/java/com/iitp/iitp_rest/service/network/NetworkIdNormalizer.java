package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.connection.ConnectionResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 수동 편집(diff 저장)으로 새로 그려진 노드/링크에 Network ID naming 스펙을 적용한다.
 *
 * <p>프론트엔드 수동 편집(iitp-front useNetworkDraw.ts)이 붙이는 새 노드/링크 id는
 * Date.now() 기반 13자리 타임스탬프라 8자리 규칙과 무관하고, Terminal 개념도 없다
 * (항상 type=normal) — 이런 "형식 자체가 안 맞는" 신규 요소만 이 클래스가 채번한다.
 *
 * <p><b>이미 8자리 규칙에 맞는 기존 노드/링크는 이번 편집으로 degree(연결 개수)가
 * 바뀌어 Terminal/Normal 분류가 실제와 안 맞게 되더라도 여기서는 절대 재채번하지
 * 않는다.</b> 그 노드를 이미 참조 중인 odmatrix.xml(source/sink)·signal.xml·
 * signalTOD.xml(node id) 같은 다른 레이어가 옛 id를 그대로 들고 있어, id를 바꾸면
 * 그 참조들이 조용히 끊어지기 때문이다. NextSim route-generator 크래시 회피에
 * 실제로 필요한 대역 정합성은 OD가 참조하는 노드로만 범위가 좁혀지므로(OD 미참조
 * 터미널은 NextSimRunner가 garage로 강등해 크래시 유발 경로에서 제외됨), 그 보정은
 * {@link com.iitp.iitp_rest.service.odmatrix.OdTerminalIdBandService#reconcileAfterNetworkEdit}
 * 가 OD 참조 갱신까지 함께 맡는다(NetworkController에서 이 정규화 다음에 호출).
 *
 * <p>대규모(스트리밍) diff 저장 경로는 전체 토폴로지를 메모리에 올리지 않으므로
 * 이 정규화 대상이 아니다 — 호출부(NetworkController)에서 일반 경로에만 적용.
 */
@Slf4j
@Component
public class NetworkIdNormalizer {

    private static final long LINK_MIN = 20_000_000L, LINK_MAX = 30_000_000L;
    private static final long NORMAL_MIN = 10_000_000L, NORMAL_MAX = 11_000_000L;
    private static final long TERMINAL_MIN = 11_000_000L, TERMINAL_MAX = 12_000_000L;
    // Garage(대중교통 차고지, 12M~13M)는 실제 존재하는 별도 대역이다(실측: bucheon 샘플에
    // 노드 12011542). degree로 판단하는 Normal/Terminal과 달리 이 정규화가 채번을 담당하지
    // 않으므로 이미 있는 Garage 노드는 그대로 두고, Normal 공유 인덱스 계산에도 절대 넣지
    // 않는다 — 예전엔 이 구분이 없어 Garage id를 "일반 노드"로 착각해 id-10,000,000을
    // 인덱스로 써버리는 바람에(12011542 → 인덱스 2,011,542) 이후 신규 채번이 전부 크게
    // 어긋나는 실측 버그가 있었다.
    private static final long GARAGE_MIN = 12_000_000L, GARAGE_MAX = 13_000_000L;

    public record NormalizeResult(NetworkResponse network,
                                   Map<Long, Long> linkIdRemap,
                                   Map<Long, Long> nodeIdRemap) {}

    public NormalizeResult normalize(NetworkResponse merged) {
        List<LinkResponse> links = merged.getLinks();
        List<NodeResponse> nodes = merged.getNodes();

        // 1) 실제 degree 재계산 (fromNode/toNode 전수 스캔, 재채번 전 원본 id 기준)
        Map<Long, Integer> degree = new HashMap<>();
        for (LinkResponse lk : links) {
            if (lk.getFromNode() != null) degree.merge(lk.getFromNode(), 1, Integer::sum);
            if (lk.getToNode() != null) degree.merge(lk.getToNode(), 1, Integer::sum);
        }

        // 2) 링크/노드별 "재채번 필요" 여부 사전 판정 + 이미 준수 중인 최대 인덱스(카운터 이어받기용).
        //    위치 인덱스 배열로 저장 — LinkResponse/NodeResponse는 @Data라 이후 id를 바꾸면
        //    hashCode가 바뀌므로 이들을 HashMap 키로 쓰면 안 된다.
        boolean[] linkNeedsNew = new boolean[links.size()];
        boolean[] nodeNeedsNew = new boolean[nodes.size()];
        long maxUsedIndex = 0;
        // 이미 규칙에 맞는 기존 터미널 id — idAssigner에 미리 등록해, 이번에 새로 파생되는
        // 터미널 id(뒷자리 3자리 매칭)가 이들과 우연히 충돌하는 것을 방지한다.
        List<Long> existingTerminalIds = new ArrayList<>();

        for (int i = 0; i < links.size(); i++) {
            Long id = links.get(i).getId();
            boolean compliant = id != null && id >= LINK_MIN && id < LINK_MAX;
            linkNeedsNew[i] = !compliant;
            if (compliant) maxUsedIndex = Math.max(maxUsedIndex, id - LINK_MIN);
        }
        for (int i = 0; i < nodes.size(); i++) {
            Long id = nodes.get(i).getId();
            boolean inNormalBand   = id != null && id >= NORMAL_MIN   && id < NORMAL_MAX;
            boolean inTerminalBand = id != null && id >= TERMINAL_MIN && id < TERMINAL_MAX;
            boolean inGarageBand   = id != null && id >= GARAGE_MIN   && id < GARAGE_MAX;
            // 이미 8자리 규칙에 맞는 기존 노드(Normal/Terminal/Garage 어느 대역이든)는 degree가
            // 편집으로 바뀌어 Terminal/Normal 분류가 실제와 안 맞게 되더라도 여기서는 재채번하지
            // 않는다 — 그 노드를 이미 참조 중인 odmatrix.xml/signal.xml 등 다른 레이어가 조용히
            // 끊어지기 때문. OD가 참조 중인 노드의 Normal/Terminal 대역 보정은
            // OdTerminalIdBandService.reconcileAfterNetworkEdit()가 OD 참조 갱신까지 함께 처리한다
            // (NetworkController에서 이 정규화 다음에 호출).
            nodeNeedsNew[i] = !(inNormalBand || inTerminalBand || inGarageBand);
            // 공유 인덱스는 Link + "일반(Normal)" Node만 소비한다 — Terminal은 페어링된 Link에서
            // 파생되는 값이라 카운터를 안 쓰고, Garage는 이 정규화가 채번을 담당하지 않는 완전히
            // 별도의 대역이라 절대 여기 섞이면 안 된다.
            if (inNormalBand) maxUsedIndex = Math.max(maxUsedIndex, id - NORMAL_MIN);
            if (inTerminalBand) existingTerminalIds.add(id);
        }

        boolean anyChange = false;
        for (boolean b : linkNeedsNew) anyChange |= b;
        for (boolean b : nodeNeedsNew) anyChange |= b;
        if (!anyChange) {
            return new NormalizeResult(merged, Map.of(), Map.of());
        }

        // 3) 링크 재채번 (원본 순서 스캔, 공유 카운터는 기존 최대 인덱스 다음부터 이어서 시작)
        NetworkIdAssigner idAssigner = new NetworkIdAssigner(maxUsedIndex + 1);
        for (Long id : existingTerminalIds) idAssigner.registerExistingTerminalId(id);
        Map<Long, Long> linkIdRemap = new HashMap<>();
        for (int i = 0; i < links.size(); i++) {
            if (!linkNeedsNew[i]) continue;
            LinkResponse lk = links.get(i);
            long oldId = lk.getId();
            long newId = idAssigner.nextLinkId();
            linkIdRemap.put(oldId, newId);
            lk.setId(newId);
        }

        // 노드(원본 id) → 그 노드에 연결된 링크의 "최종" id 목록 — Terminal 재채번 페어링용.
        // fromNode/toNode는 아직 원본 노드 id를 가리키고 있고, 링크 id는 이미 최종 확정됨.
        Map<Long, List<Long>> nodeToFinalLinkIds = new HashMap<>();
        for (LinkResponse lk : links) {
            if (lk.getFromNode() != null)
                nodeToFinalLinkIds.computeIfAbsent(lk.getFromNode(), k -> new ArrayList<>()).add(lk.getId());
            if (lk.getToNode() != null)
                nodeToFinalLinkIds.computeIfAbsent(lk.getToNode(), k -> new ArrayList<>()).add(lk.getId());
        }

        // 4) 노드 재채번 — degree<=1이면 Terminal(연결된 유일한 링크의 최종 id에서 파생),
        //    아니면 Normal. 연결 링크가 하나도 없는 고립 노드는 fallback.
        //    한 링크의 양 끝이 둘 다 재채번 대상 터미널인 경우(고립된 신규 세그먼트 등)
        //    뒷자리 파생은 그 링크당 한 번만 — 아니면 서로 다른 두 노드가 같은 id를 갖게 된다.
        Map<Long, Long> nodeIdRemap = new HashMap<>();
        Set<Long> linkClaimedForTerminal = new HashSet<>();
        for (int i = 0; i < nodes.size(); i++) {
            if (!nodeNeedsNew[i]) continue;
            NodeResponse n = nodes.get(i);
            long oldId = n.getId();
            boolean actualTerminal = degree.getOrDefault(oldId, 0) <= 1;
            List<Long> linkIds = nodeToFinalLinkIds.getOrDefault(oldId, List.of());
            long newId;
            if (actualTerminal) {
                Long pairedLink = linkIds.isEmpty() ? null : linkIds.get(0);
                if (pairedLink != null && linkClaimedForTerminal.add(pairedLink)) {
                    newId = idAssigner.terminalIdFor(pairedLink);
                } else {
                    newId = idAssigner.nextIsolatedTerminalId();
                }
                n.setType(NodeType.Terminal);
            } else {
                newId = idAssigner.nextNormalNodeId();
                n.setType(NodeType.Normal);
            }
            nodeIdRemap.put(oldId, newId);
            n.setId(newId);
        }

        // 5) 노드 id 변경분을 링크 endpoint / port / connection에 일관 반영
        for (LinkResponse lk : links) {
            if (lk.getFromNode() != null) lk.setFromNode(nodeIdRemap.getOrDefault(lk.getFromNode(), lk.getFromNode()));
            if (lk.getToNode() != null) lk.setToNode(nodeIdRemap.getOrDefault(lk.getToNode(), lk.getToNode()));
        }
        for (NodeResponse n : nodes) {
            for (PortResponse p : n.getPorts()) {
                if (p.getLinkId() == null) continue;
                try {
                    long lid = Long.parseLong(p.getLinkId());
                    Long remapped = linkIdRemap.get(lid);
                    if (remapped != null) p.setLinkId(String.valueOf(remapped));
                } catch (NumberFormatException ignored) {
                    // non-numeric link_id — 대상 아님(발생하지 않음, 방어적 처리)
                }
            }
            for (ConnectionResponse c : n.getConnections()) {
                if (c.getFromLink() != null) c.setFromLink(linkIdRemap.getOrDefault(c.getFromLink(), c.getFromLink()));
                if (c.getToLink() != null) c.setToLink(linkIdRemap.getOrDefault(c.getToLink(), c.getToLink()));
            }
        }

        log.info("[NetworkIdNormalizer] 수동 편집 저장 — 재채번: 링크 {}개, 노드 {}개", linkIdRemap.size(), nodeIdRemap.size());
        return new NormalizeResult(merged, linkIdRemap, nodeIdRemap);
    }
}
