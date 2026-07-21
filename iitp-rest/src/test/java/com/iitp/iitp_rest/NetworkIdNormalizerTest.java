package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.service.network.NetworkIdNormalizer;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 수동 편집 diff 저장 후 병합 네트워크 재채번({@link NetworkIdNormalizer}) 검증.
 * DB/Spring 컨텍스트 불필요 — 순수 단위 테스트.
 */
class NetworkIdNormalizerTest {

    private final NetworkIdNormalizer normalizer = new NetworkIdNormalizer();

    private static NodeResponse node(long id) {
        return node(id, NodeType.Normal);
    }

    private static NodeResponse node(long id, NodeType type) {
        NodeResponse n = new NodeResponse();
        n.setId(id);
        n.setType(type);
        return n;
    }

    private static LinkResponse link(long id, long fromNode, long toNode) {
        LinkResponse l = new LinkResponse();
        l.setId(id);
        l.setFromNode(fromNode);
        l.setToNode(toNode);
        return l;
    }

    /**
     * 회귀 검증 — 프론트에서 완전히 새로 그린, 아직 아무 것에도 안 붙은 독립 세그먼트
     * (양 끝 노드 둘 다 degree=1) 하나만 저장했을 때: 두 노드가 같은 Link에서 뒷자리를
     * 파생시키면 서로 다른 두 노드가 같은 id를 갖게 되는 버그가 있었다 — 한쪽만 파생시키고
     * 나머지는 fallback(고립 터미널)을 쓰도록 고쳤는지 확인한다.
     */
    @Test
    void isolatedNewSegment_bothEndsTerminal_getDistinctIds() {
        long tsA = 1_753_000_000_123L; // 프론트 Date.now() 스타일 임시 id
        long tsB = tsA + 1;
        long tsLink = tsA + 2;

        NetworkResponse merged = new NetworkResponse();
        merged.setNodes(List.of(node(tsA), node(tsB)));
        merged.setLinks(List.of(link(tsLink, tsA, tsB)));

        NetworkIdNormalizer.NormalizeResult result = normalizer.normalize(merged);

        assertEquals(1, result.linkIdRemap().size());
        assertEquals(2, result.nodeIdRemap().size());

        List<NodeResponse> nodes = result.network().getNodes();
        List<LinkResponse> links = result.network().getLinks();

        long newLinkId = links.get(0).getId();
        assertTrue(newLinkId >= 20_000_001L && newLinkId < 30_000_000L, "링크는 2 접두사 8자리");

        long idA = nodes.get(0).getId();
        long idB = nodes.get(1).getId();
        assertNotEquals(idA, idB, "양 끝이 둘 다 터미널이어도 서로 다른 id를 가져야 함");

        for (long id : List.of(idA, idB)) {
            assertTrue(id >= 11_000_001L && id < 12_000_000L, "터미널은 11 접두사 8자리: " + id);
            assertEquals(NodeType.Terminal, nodes.stream()
                    .filter(n -> n.getId() == id).findFirst().get().getType());
        }

        // 정확히 한쪽만 링크 뒷자리 파생 규칙을 따름 (id % 1_000_000 == newLinkId % 1_000_000)
        long linkSuffix = newLinkId % 1_000_000L;
        boolean aMatches = (idA % 1_000_000L) == linkSuffix;
        boolean bMatches = (idB % 1_000_000L) == linkSuffix;
        assertTrue(aMatches ^ bMatches, "정확히 한쪽 노드만 링크와 뒷자리가 일치해야 함(양쪽 다 일치=충돌 버그)");

        // 링크의 fromNode/toNode도 새 노드 id로 일관되게 갱신됐는지 확인
        assertEquals(idA, links.get(0).getFromNode());
        assertEquals(idB, links.get(0).getToNode());
    }

    /** 일반적인 막다른 길(터미널 하나 + 교차로 하나)은 기존처럼 정확히 뒷자리가 일치해야 한다. */
    @Test
    void singleTerminalEnd_matchesConnectedLinkSuffix() {
        long tsTerm = 1_753_000_000_500L;
        long existingIntersection = 10_000_050L; // 이미 규칙에 맞는 기존 교차로(degree 유지 목적상 다른 링크 필요)
        long otherNeighbor = 10_000_051L;
        long tsLink = tsTerm + 1;
        long existingLink = 20_000_050L;

        NetworkResponse merged = new NetworkResponse();
        merged.setNodes(List.of(node(tsTerm), node(existingIntersection), node(otherNeighbor)));
        merged.setLinks(List.of(
                link(tsLink, tsTerm, existingIntersection),
                link(existingLink, existingIntersection, otherNeighbor)
        ));

        NetworkIdNormalizer.NormalizeResult result = normalizer.normalize(merged);

        long newTermId = result.nodeIdRemap().get(tsTerm);
        long newLinkId = result.linkIdRemap().get(tsLink);
        assertEquals(newLinkId % 1_000_000L, newTermId % 1_000_000L);
        assertTrue(newTermId >= 11_000_001L && newTermId < 12_000_000L);

        // 이미 규칙에 맞고 degree도 그대로인 기존 교차로는 건드리지 않아야 함
        assertTrue(!result.nodeIdRemap().containsKey(existingIntersection), "degree 안 바뀐 기존 교차로는 재채번 대상 아님");
    }

    /**
     * 기존에 이미 규칙에 맞던 Terminal(11xxxxxx)이 이번 편집으로 링크가 하나 더 연결돼
     * degree 1→2가 되는 경우("막다른 길 연장") — 더 이상 실제로는 터미널이 아니지만,
     * odmatrix.xml/signal.xml 등 다른 레이어가 이미 이 id를 참조하고 있을 수 있으므로
     * 여기서는 재채번하지 않는다(id/type 그대로 유지). 이 경우의 대역 보정은
     * OD가 실제로 참조 중일 때에 한해 OdTerminalIdBandService가 별도로 담당한다.
     */
    @Test
    void existingTerminal_gainsSecondLink_isNotTouched() {
        long existingTerminal = 11_000_010L; // 기존 network.xml: Link 20000010 하나만 연결된 터미널
        long existingLink = 20_000_010L;
        long farEnd = 10_000_011L;
        long farEnd2 = 10_000_012L;
        long anotherExistingLink = 20_000_011L;

        long tsNewNode = 1_753_000_001_000L; // 새로 그린 노드
        long tsNewLink = tsNewNode + 1;      // existingTerminal ↔ tsNewNode 로 새로 그은 링크

        NetworkResponse merged = new NetworkResponse();
        merged.setNodes(List.of(
                node(existingTerminal, NodeType.Terminal),
                node(farEnd),
                node(farEnd2),
                node(tsNewNode)
        ));
        merged.setLinks(List.of(
                link(existingLink, existingTerminal, farEnd),
                link(anotherExistingLink, farEnd, farEnd2),
                link(tsNewLink, existingTerminal, tsNewNode)
        ));

        NetworkIdNormalizer.NormalizeResult result = normalizer.normalize(merged);

        assertTrue(!result.nodeIdRemap().containsKey(existingTerminal),
                "degree가 바뀌어도 이미 규칙에 맞는 기존 노드는 재채번 대상 아님");
        NodeResponse unchanged = result.network().getNodes().stream()
                .filter(n -> n.getId() == existingTerminal).findFirst().orElseThrow();
        assertEquals(NodeType.Terminal, unchanged.getType(), "type도 그대로 유지(다른 레이어 참조 보호)");
        assertTrue(!result.linkIdRemap().containsKey(existingLink));

        // 새로 그린 노드/링크는 평소처럼 규칙대로 채번됨
        assertTrue(result.nodeIdRemap().containsKey(tsNewNode));
        assertTrue(result.linkIdRemap().containsKey(tsNewLink));
    }

    /**
     * 기존에 이미 규칙에 맞던 일반 노드(10xxxxxx)가 이번 편집으로 연결 링크가 하나 삭제돼
     * degree 2→1이 되는 경우도 마찬가지로 — 여기서는 재채번하지 않는다.
     */
    @Test
    void existingNormal_losesLink_isNotTouched() {
        long existingNormal = 10_000_020L;
        long remainingLink = 20_000_020L; // 삭제 후에도 남는 링크
        long neighborA = 10_000_021L;

        // 삭제된 링크(20000021, existingNormal↔neighborB)는 diff로 이미 빠져있음 —
        // merged에는 remainingLink 하나만 남아 existingNormal의 degree가 1이 된 상태를 재현.
        NetworkResponse merged = new NetworkResponse();
        merged.setNodes(List.of(node(existingNormal), node(neighborA)));
        merged.setLinks(List.of(link(remainingLink, existingNormal, neighborA)));

        NetworkIdNormalizer.NormalizeResult result = normalizer.normalize(merged);

        assertTrue(!result.nodeIdRemap().containsKey(existingNormal),
                "degree가 바뀌어도 이미 규칙에 맞는 기존 노드는 재채번 대상 아님");
        NodeResponse unchanged = result.network().getNodes().stream()
                .filter(n -> n.getId() == existingNormal).findFirst().orElseThrow();
        assertEquals(NodeType.Normal, unchanged.getType());
        assertTrue(!result.linkIdRemap().containsKey(remainingLink));
    }

    /**
     * 회귀 검증(실 데이터로 발견) — 네트워크에 실제 Garage 노드(12xxxxxx, 대중교통 차고지)가
     * 있으면: (1) 그 노드는 절대 안 건드리고, (2) "id - 10,000,000"을 일반 노드 인덱스로
     * 착각해 공유 카운터가 수백만 단위로 튀는 일이 없어야 한다. bucheon 샘플 데이터(노드
     * 12011542)로 새 세그먼트를 저장했을 때 22011543/13011544 같은 엉뚱한 id가 나온 실제
     * 버그를 재현한다.
     */
    @Test
    void existingGarageNode_isIgnored_doesNotPolluteSharedCounter() {
        long garageNode = 12_011_542L; // 실측: bucheon 샘플의 실제 대중교통 차고지 노드
        long existingNormal = 10_011_533L; // 이 네트워크의 실제 최대 일반 노드 id
        long neighborA = 10_000_001L;
        long existingLink = 20_011_536L; // 이 네트워크의 실제 최대 링크 id

        long tsA = 1_753_100_000_001L; // 새로 그린 고립 세그먼트(양 끝 다 새 노드)
        long tsB = 1_753_100_000_002L;
        long tsLink = 1_753_100_000_003L;

        NetworkResponse merged = new NetworkResponse();
        merged.setNodes(List.of(
                node(garageNode, NodeType.Garage), // 어느 링크에도 안 붙은 독립 노드(실측과 동일)
                node(existingNormal),
                node(neighborA),
                node(tsA),
                node(tsB)
        ));
        merged.setLinks(List.of(
                link(existingLink, existingNormal, neighborA),
                link(tsLink, tsA, tsB)
        ));

        NetworkIdNormalizer.NormalizeResult result = normalizer.normalize(merged);

        assertTrue(!result.nodeIdRemap().containsKey(garageNode), "Garage 노드는 재채번 대상 아님");
        NodeResponse garageUnchanged = result.network().getNodes().stream()
                .filter(n -> n.getId() == garageNode).findFirst().orElseThrow();
        assertEquals(NodeType.Garage, garageUnchanged.getType());

        // 공유 카운터는 기존 최대 인덱스(link=11536, normal=11533 중 큰 쪽) 다음부터 이어져야
        // 한다 — Garage의 "id-10,000,000"(2,011,542) 이 섞이면 안 됨.
        long newLinkId = result.linkIdRemap().get(tsLink);
        assertTrue(newLinkId < 20_020_000L,
                "Garage id에 오염되지 않은 정상 범위여야 함(실제 버그였다면 22011543 같은 값이 나옴): " + newLinkId);
    }
}
