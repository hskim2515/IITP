package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.service.simulation.NextSimInputScaffolder;
import com.iitp.iitp_rest.service.vehicle.DummySignalGenerator;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * KTDB 임포트 시 signal.xml 자동 생성(더미 신호 생성기 재사용, buildSampleOdMatrix 와 동일 원칙) 검증 —
 * 생성된 signal.xml 이 NextSimInputScaffolder 의 유효성/TOD 커버리지 검사를 그대로 통과해야
 * "신호 데이터 없음"으로 무결성 검사가 실패하던 문제(신호등/TOD 데이터가 안 만들어짐)가 실제로 해결된다.
 */
class DummySignalGeneratorXmlTest {

    private final DummySignalGenerator generator = new DummySignalGenerator();

    private static ConnectionXml conn(long id, long fromLink, long toLink, Turning turning) {
        ConnectionXml c = new ConnectionXml();
        c.setId(id);
        c.setFromLink(fromLink);
        c.setToLink(toLink);
        c.setTurning(turning);
        return c;
    }

    /** 접근 방향(fromLink) 3개인 교차로 노드 — 신호 필요 */
    private static NodeXml intersectionNode(long nodeId) {
        NodeXml n = new NodeXml();
        n.setId(nodeId);
        n.setConnections(List.of(
                conn(1, 100, 200, Turning.Straight),
                conn(2, 100, 300, Turning.Left_Turn),
                conn(3, 200, 100, Turning.Right_Turn),
                conn(4, 300, 100, Turning.Straight)
        ));
        return n;
    }

    private static NetworkXml networkWith(NodeXml... nodes) {
        NetworkXml net = new NetworkXml();
        net.setNodes(List.of(nodes));
        return net;
    }

    @Test
    void generates_signal_node_for_intersection_with_multiple_approaches() {
        NetworkXml network = networkWith(intersectionNode(10000001L));
        String xml = generator.generateSignalXml(network);

        assertTrue(xml.contains("<node id=\"10000001\">"), "접근 2개 이상 노드는 신호 노드로 생성돼야 함");
        assertTrue(xml.contains("<planList>") && xml.contains("<plan "), "플랜이 있어야 함");
        // scaffolder 의 signalValid/extractSignalPlanNodeIds 로 그대로 소비 가능해야 함
        assertTrue(NextSimInputScaffolder.signalValid(xml, Set.of("10000001")));
        assertEquals(Set.of("10000001"), NextSimInputScaffolder.extractSignalPlanNodeIds(xml));
    }

    @Test
    void skips_nodes_without_multiple_approaches() {
        NodeXml deadEnd = new NodeXml();
        deadEnd.setId(20000001L);
        deadEnd.setConnections(List.of(conn(1, 100, 200, Turning.Straight))); // 접근 1개뿐

        NodeXml noConn = new NodeXml();
        noConn.setId(20000002L);
        noConn.setConnections(List.of());

        String xml = generator.generateSignalXml(networkWith(deadEnd, noConn));
        assertTrue(NextSimInputScaffolder.extractSignalPlanNodeIds(xml).isEmpty(),
                "접근 1개 이하 노드는 신호 노드로 생성되면 안 됨");
    }

    @Test
    void skips_node_where_all_approaches_are_right_turn_only() {
        NodeXml n = new NodeXml();
        n.setId(30000001L);
        n.setConnections(List.of(
                conn(1, 100, 200, Turning.Right_Turn),
                conn(2, 200, 100, Turning.Right_Turn)
        ));
        String xml = generator.generateSignalXml(networkWith(n));
        assertTrue(NextSimInputScaffolder.extractSignalPlanNodeIds(xml).isEmpty(),
                "전부 RTOR 이면 신호 자체가 불필요 — 생성하지 않아야 함");
    }

    @Test
    void generated_signal_produces_valid_default_tod_via_scaffolder() {
        NetworkXml network = networkWith(intersectionNode(10000001L));
        String signalXml = generator.generateSignalXml(network);

        Set<String> planNodes = NextSimInputScaffolder.extractSignalPlanNodeIds(signalXml);
        String tod = NextSimInputScaffolder.buildDefaultSignalTod(signalXml, planNodes);

        assertTrue(NextSimInputScaffolder.signalTodValid(tod, planNodes),
                "더미 신호 생성 결과에 대해 buildDefaultSignalTod 로 만든 TOD 는 항상 유효해야 함 " +
                "(signal 재생성 시 TOD 도 같이 채워지는 실제 배선 경로 재현)");
    }

    @Test
    void multiple_intersections_each_get_independent_signal_nodes() {
        NetworkXml network = networkWith(intersectionNode(10000001L), intersectionNode(10000002L));
        String xml = generator.generateSignalXml(network);
        assertEquals(Set.of("10000001", "10000002"), NextSimInputScaffolder.extractSignalPlanNodeIds(xml));
    }
}
