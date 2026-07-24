package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실제 회전 허용(커넥션) 그래프 기준 도달 가능성 계산 검증 — scenario1_2(11000174)/대전
 * 오정동(11000357)에서 gdb로 확정한 근본원인의 회귀 방지.
 *
 * <p>핵심: 링크가 인접해 있어도(from_node/to_node 체인) 경로상의 교차로에 그 회전을 허용하는
 * {@code <connection>} 이 없으면 실제로는 통행 불가능하다 — 실측(11000357): 순수 링크
 * 인접 그래프로는 도달 가능해 보였지만 실제 커넥션 그래프로는 불가능했고, route-generator가
 * Route.json 을 빈 채로 남기고 nextsim이 크래시했다.
 */
class NetworkReachabilityServiceTest {

    private final NetworkReachabilityService service = new NetworkReachabilityService();

    private static LinkXml link(long id, long from, long to) {
        LinkXml l = new LinkXml();
        l.setId(id);
        l.setFromNode(from);
        l.setToNode(to);
        return l;
    }

    private static NodeXml node(long id, NodeType type, List<ConnectionXml> connections) {
        NodeXml n = new NodeXml();
        n.setId(id);
        n.setType(type);
        n.setConnections(connections);
        return n;
    }

    private static ConnectionXml conn(long fromLink, long toLink) {
        ConnectionXml c = new ConnectionXml();
        c.setFromLink(fromLink);
        c.setToLink(toLink);
        return c;
    }

    /**
     * 1 --(link1)--> 2 --(link2)--> 3, 노드 2 에 link1→link2 커넥션이 있으면 통과 가능.
     * 커넥션이 없으면(막힌 교차로) 링크는 이어져 있어도 실제로는 통행 불가.
     */
    @Test
    void intermediateNodeWithoutConnectionBlocksPath() {
        NetworkXml net = new NetworkXml();
        net.setLinks(List.of(link(1, 1, 2), link(2, 2, 3)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()),
                node(2, NodeType.Normal, List.of()), // 커넥션 없음 — 회전 불허
                node(3, NodeType.Terminal, List.of())));

        Map<String, List<String>> linkGraph = service.buildLinkConnectionGraph(net);
        Map<String, List<String>> nodeOut = service.buildNodeOutLinks(net);
        Map<String, List<String>> nodeIn = service.buildNodeInLinks(net);

        assertThat(service.isNodeReachable(linkGraph, nodeOut, nodeIn, "1", "3")).isFalse();
    }

    @Test
    void intermediateNodeWithConnectionAllowsPath() {
        NetworkXml net = new NetworkXml();
        net.setLinks(List.of(link(1, 1, 2), link(2, 2, 3)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()),
                node(2, NodeType.Normal, List.of(conn(1, 2))), // link1→link2 회전 허용
                node(3, NodeType.Terminal, List.of())));

        Map<String, List<String>> linkGraph = service.buildLinkConnectionGraph(net);
        Map<String, List<String>> nodeOut = service.buildNodeOutLinks(net);
        Map<String, List<String>> nodeIn = service.buildNodeInLinks(net);

        assertThat(service.isNodeReachable(linkGraph, nodeOut, nodeIn, "1", "3")).isTrue();
    }

    @Test
    void deadEndPocketUnreachableFromOutside() {
        // 메인 도로: 1 -> 2 -> 3 (연결 허용).  고립 포켓: 4 -> 5 (외부에서 진입 불가)
        NetworkXml net = new NetworkXml();
        net.setLinks(List.of(link(1, 1, 2), link(2, 2, 3), link(3, 4, 5)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()),
                node(2, NodeType.Normal, List.of(conn(1, 2))),
                node(3, NodeType.Terminal, List.of()),
                node(4, NodeType.Terminal, List.of()),
                node(5, NodeType.Terminal, List.of())));

        Map<String, List<String>> linkGraph = service.buildLinkConnectionGraph(net);
        Map<String, List<String>> nodeOut = service.buildNodeOutLinks(net);
        Map<String, List<String>> nodeIn = service.buildNodeInLinks(net);

        assertThat(service.isNodeReachable(linkGraph, nodeOut, nodeIn, "1", "5")).isFalse();
        assertThat(service.isNodeReachable(linkGraph, nodeOut, nodeIn, "4", "5")).isTrue();
    }

    private static OdMatrixXml odWith(OdMatrixXml.DemandXml... demands) {
        OdMatrixXml od = new OdMatrixXml();
        var nvod = new OdMatrixXml.NvOdMatrixXml();
        nvod.setDemands(new java.util.ArrayList<>(List.of(demands)));
        var item = new OdMatrixXml.OdMatrixItemXml();
        item.setNvodMatrix(nvod);
        od.setOdMatrices(new java.util.ArrayList<>(List.of(item)));
        return od;
    }

    private static OdMatrixXml.DemandXml demand(String src, String snk) {
        OdMatrixXml.DemandXml d = new OdMatrixXml.DemandXml();
        d.setSource(src); d.setSink(snk); d.setFlow(10.0);
        return d;
    }

    @Test
    void filterUnreachableDemandsRemovesOnlyUnreachablePairs() {
        NetworkXml net = new NetworkXml();
        net.setLinks(List.of(link(1, 1, 2), link(2, 2, 3), link(3, 4, 5)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()),
                node(2, NodeType.Normal, List.of(conn(1, 2))),
                node(3, NodeType.Terminal, List.of()),
                node(4, NodeType.Terminal, List.of()),
                node(5, NodeType.Terminal, List.of())));

        OdMatrixXml od = odWith(demand("1", "3"), demand("1", "5"));

        int removed = service.filterUnreachableDemands(od, net);

        assertThat(removed).isEqualTo(1);
        assertThat(od.getOdMatrices().get(0).getNvodMatrix().getDemands())
                .extracting(OdMatrixXml.DemandXml::getSink)
                .containsExactly("3");
    }

    @Test
    void nothingRemovedWhenAllReachable() {
        NetworkXml net = new NetworkXml();
        net.setLinks(List.of(link(1, 1, 2), link(2, 2, 3)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()),
                node(2, NodeType.Normal, List.of(conn(1, 2))),
                node(3, NodeType.Terminal, List.of())));

        OdMatrixXml od = odWith(demand("1", "3"));

        assertThat(service.filterUnreachableDemands(od, net)).isZero();
    }

    /** 링크는 인접해 있어도 중간 교차로에 회전 허용 커넥션이 없으면 걸러져야 한다. */
    @Test
    void filterUnreachableDemandsCatchesMissingConnectionEvenWithLinkAdjacency() {
        NetworkXml net = new NetworkXml();
        net.setLinks(List.of(link(1, 1, 2), link(2, 2, 3)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()),
                node(2, NodeType.Normal, List.of()), // 커넥션 없음 — 링크만 인접
                node(3, NodeType.Terminal, List.of())));

        OdMatrixXml od = odWith(demand("1", "3"));

        int removed = service.filterUnreachableDemands(od, net);

        assertThat(removed).isEqualTo(1);
        assertThat(od.getOdMatrices().get(0).getNvodMatrix().getDemands()).isEmpty();
    }

    /**
     * 실측(gdb, scenario1_2 최신 재임포트): 고립된 섬 안의 두 노드끼리는 서로 커넥션 경로가
     * 있어도, 둘 다 메인 컴포넌트 밖이라 NextSimRunner.injectRequiredNetworkAttrs 가 garage 로
     * 전환한다 — 이 경우도 순수 그래프 도달 가능성만으론 못 잡고 노드 타입까지 봐야 걸러진다.
     */
    @Test
    void removesDemandWhenSourceOrSinkIsNotTerminalEvenIfReachable() {
        NetworkXml net = new NetworkXml();
        // 4 -> 5 는 서로 커넥션 필요 없는 단일 링크로 도달 가능하지만 격리로 garage 전환됨
        net.setLinks(List.of(link(1, 1, 2), link(2, 4, 5)));
        net.setNodes(List.of(
                node(1, NodeType.Terminal, List.of()), node(2, NodeType.Terminal, List.of()),
                node(4, NodeType.Garage, List.of()), node(5, NodeType.Garage, List.of())));

        OdMatrixXml od = odWith(demand("1", "2"), demand("4", "5"));

        int removed = service.filterUnreachableDemands(od, net);

        assertThat(removed).isEqualTo(1);
        assertThat(od.getOdMatrices().get(0).getNvodMatrix().getDemands())
                .extracting(OdMatrixXml.DemandXml::getSink)
                .containsExactly("2");
    }

    /**
     * 대규모 네트워크(스트리밍 diff 저장 경로)용 Path 오버로드 — network.xml 을 객체화하지 않고
     * 정규식 스트림 스캔으로 동일 판정을 내리는지 검증. 객체 기반 오버로드와 동일 시나리오
     * (filterUnreachableDemandsCatchesMissingConnectionEvenWithLinkAdjacency)를 파일로 재현.
     */
    @Test
    void pathOverloadCatchesMissingConnectionEvenWithLinkAdjacency(@TempDir Path tmp) throws Exception {
        String networkXml = """
                <Network>
                <node id="1" type="terminal"/>
                <node id="2" type="normal"/>
                <node id="3" type="terminal"/>
                <link id="1" from_node="1" to_node="2"/>
                <link id="2" from_node="2" to_node="3"/>
                </Network>
                """;
        Path networkFile = tmp.resolve("network.xml");
        Files.writeString(networkFile, networkXml);

        OdMatrixXml od = odWith(demand("1", "3"));

        int removed = service.filterUnreachableDemands(od, networkFile);

        assertThat(removed).isEqualTo(1);
        assertThat(od.getOdMatrices().get(0).getNvodMatrix().getDemands()).isEmpty();
    }

    /** Path 오버로드도 커넥션이 있으면 정상적으로 도달 가능 판정한다. */
    @Test
    void pathOverloadKeepsReachableDemand(@TempDir Path tmp) throws Exception {
        String networkXml = """
                <Network>
                <node id="1" type="terminal"/>
                <node id="2" type="normal">
                    <connection id="0" from_link="1" to_link="2" turning="S"/>
                </node>
                <node id="3" type="terminal"/>
                <link id="1" from_node="1" to_node="2"/>
                <link id="2" from_node="2" to_node="3"/>
                </Network>
                """;
        Path networkFile = tmp.resolve("network.xml");
        Files.writeString(networkFile, networkXml);

        OdMatrixXml od = odWith(demand("1", "3"));

        assertThat(service.filterUnreachableDemands(od, networkFile)).isZero();
        assertThat(od.getOdMatrices().get(0).getNvodMatrix().getDemands()).hasSize(1);
    }
}
