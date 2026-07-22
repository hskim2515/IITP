package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.service.simulation.NextSimInputScaffolder;
import com.iitp.iitp_rest.service.vehicle.DummySignalGenerator;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

    // ── 평시/혼잡 두 플랜 + 현실적인 TOD ─────────────────────────────────────────

    @Test
    void generates_both_offpeak_and_peak_plans() {
        NetworkXml network = networkWith(intersectionNode(10000001L));
        String xml = generator.generateSignalXml(network);

        // intersectionNode: 신호 필요 접근로는 100/300 두 개뿐(200은 전부 RTOR라 제외).
        // 좌표(center/link) 데이터가 없어 페어링 불가 → 단독 페이즈 2개 × (녹색+황색)
        assertTrue(xml.contains("<plan id=\"0\" cycle=\"46\""), "평시(plan 0): 단독 페이즈 2개 × (20+3)초");
        assertTrue(xml.contains("<plan id=\"1\" cycle=\"66\""), "혼잡(plan 1): 단독 페이즈 2개 × (30+3)초, 처리용량 확보 위해 페이즈당 녹색 시간이 더 김");
    }

    /**
     * 사용자 지적("양쪽에서 파란불이면 교통사고 발생하잖아")에 대한 안전망 검증 —
     * 접근로 좌표(방위각 계산용) 데이터가 아예 없을 때(이 테스트처럼 NodeXml.center/
     * LinkXml.from_node·to_node를 안 채운 경우), 서로 다른 두 접근로의 turn이 같은
     * phase의 turnList에 동시에 등장하면 안 된다(RTOR 제외) — 페어링을 시도조차 못 하니
     * 전부 단독 페이즈로 안전하게 폴백해야 한다. 방위각 기반 페어링으로 바꾸기 전에는
     * 좌표 유무와 무관하게 접근로를 임의로 두 그룹으로 묶어 동시 운영했기 때문에, 데이터
     * 순서에 따라 마주보지 않는(직교하는) 접근로끼리 묶여 이 불변식이 깨질 수 있었다.
     */
    @Test
    void no_phase_activates_conflicting_approaches_when_geometry_is_unavailable() {
        NodeXml fourWay = new NodeXml();
        fourWay.setId(40000001L);
        fourWay.setConnections(List.of(
                conn(1, 100, 300, Turning.Straight),   // 접근 100(→200이 직교라 가정)
                conn(2, 100, 400, Turning.Left_Turn),
                conn(3, 200, 400, Turning.Straight),   // 접근 200
                conn(4, 200, 100, Turning.Left_Turn),
                conn(5, 300, 100, Turning.Straight),   // 접근 300
                conn(6, 300, 200, Turning.Left_Turn),
                conn(7, 400, 200, Turning.Straight),   // 접근 400
                conn(8, 400, 300, Turning.Left_Turn)
        ));
        String xml = generator.generateSignalXml(networkWith(fourWay));

        // turn id -> type(RTOR 인지) 매핑
        Map<String, Boolean> turnIsRtor = new HashMap<>();
        Matcher turnM = Pattern.compile("<turn id=\"(\\d+)\" turning=\"[^\"]+\" type=\"(\\w+)\"").matcher(xml);
        while (turnM.find()) turnIsRtor.put(turnM.group(1), "RTOR".equals(turnM.group(2)));

        Matcher phaseM = Pattern.compile("<phase id=\"\\d+\" duration=\"\\d+\" turnList=\"([^\"]*)\"").matcher(xml);
        int phasesChecked = 0;
        while (phaseM.find()) {
            String[] ids = phaseM.group(1).trim().isEmpty() ? new String[0] : phaseM.group(1).split(" ");
            long nonRtorCount = java.util.Arrays.stream(ids)
                    .filter(id -> !turnIsRtor.getOrDefault(id, true))
                    .count();
            assertTrue(nonRtorCount <= 1,
                    "한 phase에 서로 다른 접근로가 동시에 활성화됨(충돌 가능) turnList=" + phaseM.group(1));
            phasesChecked++;
        }
        assertTrue(phasesChecked > 0, "검증할 phase가 하나도 파싱되지 않음");
    }

    /**
     * 방위각 기반 페어링의 핵심 시나리오 — 실좌표를 갖춘 정상적인 4지 교차로(N/E/S/W)에서
     * 마주보는 접근로(N↔S, E↔W)끼리는 같은 phase로 묶여 동시 녹색이 되고, 직교하는
     * 접근로(N-E, N-W 등)는 어떤 phase에서도 함께 등장하면 안 된다. 사용자 요청
     * ("현실 도로 신호체계랑 되도록이면 유사하게")에 대응하는 실제 2페이즈 신호 재현 검증.
     */
    @Test
    void pairs_opposite_approaches_and_never_pairs_perpendicular_ones() {
        NodeXml center = new NodeXml();
        center.setId(50000000L);
        center.setCenter("0 0");
        center.setConnections(List.of(
                conn(1, 500001, 500999, Turning.Straight), // N에서 진입
                conn(2, 500002, 500999, Turning.Straight), // E에서 진입
                conn(3, 500003, 500999, Turning.Straight), // S에서 진입
                conn(4, 500004, 500999, Turning.Straight)  // W에서 진입
        ));

        NodeXml n = new NodeXml(); n.setId(1L); n.setCenter("0 100");
        NodeXml e = new NodeXml(); e.setId(2L); e.setCenter("100 0");
        NodeXml s = new NodeXml(); s.setId(3L); s.setCenter("0 -100");
        NodeXml w = new NodeXml(); w.setId(4L); w.setCenter("-100 0");

        LinkXml linkN = new LinkXml(); linkN.setId(500001L); linkN.setFromNode(1L); linkN.setToNode(50000000L);
        LinkXml linkE = new LinkXml(); linkE.setId(500002L); linkE.setFromNode(2L); linkE.setToNode(50000000L);
        LinkXml linkS = new LinkXml(); linkS.setId(500003L); linkS.setFromNode(3L); linkS.setToNode(50000000L);
        LinkXml linkW = new LinkXml(); linkW.setId(500004L); linkW.setFromNode(4L); linkW.setToNode(50000000L);

        NetworkXml network = networkWith(center, n, e, s, w);
        network.setLinks(List.of(linkN, linkE, linkS, linkW));

        String xml = generator.generateSignalXml(network);

        // 접근로 4개가 마주보는 2쌍으로 묶였다면 phase(그룹)는 2개 → 사이클 = 2*(20+3) = 46
        // (페어링 없이 전부 단독이었다면 4*(20+3)=92가 됐을 것)
        assertTrue(xml.contains("<plan id=\"0\" cycle=\"46\""),
                "마주보는 접근로끼리 페어링되면 페이즈가 2개로 줄어 사이클이 46초여야 함: " + xml);

        // turn id -> fromLink 역추적: connList의 커넥션 id(1~4)가 곧 접근로(N=1,E=2,S=3,W=4) 순번
        Map<String, Set<String>> turnToConnIds = new HashMap<>();
        Matcher turnM = Pattern.compile("<turn id=\"(\\d+)\" turning=\"S\" type=\"None\" connList=\"([^\"]*)\"").matcher(xml);
        while (turnM.find()) {
            turnToConnIds.put(turnM.group(1), Set.of(turnM.group(2).split(" ")));
        }

        Matcher phaseM = Pattern.compile("<phase id=\"\\d+\" duration=\"20\" turnList=\"([^\"]*)\"").matcher(xml);
        List<Set<String>> greenPhaseApproaches = new ArrayList<>();
        while (phaseM.find()) {
            Set<String> connIdsInPhase = new HashSet<>();
            for (String tid : phaseM.group(1).trim().split(" ")) {
                Set<String> c = turnToConnIds.get(tid);
                if (c != null) connIdsInPhase.addAll(c);
            }
            if (!connIdsInPhase.isEmpty()) greenPhaseApproaches.add(connIdsInPhase);
        }

        assertEquals(2, greenPhaseApproaches.size(), "녹색 페이즈는 정확히 2개(N-S 쌍, E-W 쌍)여야 함");
        for (Set<String> phaseConns : greenPhaseApproaches) {
            assertEquals(2, phaseConns.size(), "각 페이즈는 정확히 접근로 2개(마주보는 쌍)를 포함해야 함: " + phaseConns);
            boolean isNS = phaseConns.equals(Set.of("1", "3"));
            boolean isEW = phaseConns.equals(Set.of("2", "4"));
            assertTrue(isNS || isEW,
                    "직교하는 접근로끼리 묶이면 안 됨(충돌 위험) — 실제로 묶인 접근로: " + phaseConns);
        }
    }

    /**
     * {@link DummySignalGenerator#generate} (signal.xml이 아예 없거나 파싱 실패했을 때
     * VehicleController.buildSignalContext가 폴백으로 쓰는, 차량 CZML 미리보기용 더미 신호)도
     * generateSignalXml과 동일한 방위각 기반 페어링을 써야 한다 — 안 그러면 실제 signal.xml
     * (안전한 페어링)과 이 미리보기(예전엔 짝/홀 인덱스로 임의 페어링)가 서로 다른 조합을
     * 보여줘 일관성이 깨진다. 마주보는 N-S/E-W끼리만 같은 phase에 묶이는지, 그리고 cycle이
     * 실제 phase duration 합과 항상 일치하는지(안 맞으면 뒤쪽 phase가 영원히 안 켜지는
     * 버그로 이어짐, DummyVehicleGenerator.isPhaseGreen의 cyclePos wraparound 로직 참고)
     * 확인한다.
     */
    @Test
    void generate_for_vehicle_preview_also_pairs_opposite_approaches() {
        NodeXml center = new NodeXml();
        center.setId(50000000L);
        center.setCenter("0 0");
        center.setConnections(List.of(
                conn(1, 500001, 500999, Turning.Straight), // N
                conn(2, 500002, 500999, Turning.Straight), // E
                conn(3, 500003, 500999, Turning.Straight), // S
                conn(4, 500004, 500999, Turning.Straight)  // W
        ));
        NodeXml n = new NodeXml(); n.setId(1L); n.setCenter("0 100");
        NodeXml e = new NodeXml(); e.setId(2L); e.setCenter("100 0");
        NodeXml s = new NodeXml(); s.setId(3L); s.setCenter("0 -100");
        NodeXml w = new NodeXml(); w.setId(4L); w.setCenter("-100 0");
        LinkXml linkN = new LinkXml(); linkN.setId(500001L); linkN.setFromNode(1L); linkN.setToNode(50000000L);
        LinkXml linkE = new LinkXml(); linkE.setId(500002L); linkE.setFromNode(2L); linkE.setToNode(50000000L);
        LinkXml linkS = new LinkXml(); linkS.setId(500003L); linkS.setFromNode(3L); linkS.setToNode(50000000L);
        LinkXml linkW = new LinkXml(); linkW.setId(500004L); linkW.setFromNode(4L); linkW.setToNode(50000000L);
        NetworkXml network = networkWith(center, n, e, s, w);
        network.setLinks(List.of(linkN, linkE, linkS, linkW));

        var ctx = generator.generate(network, Map.of());
        var signal = ctx.nodeSignals.get("50000000");
        assertNotNull(signal, "교차로 노드는 신호 정보를 가져야 함");

        // cycle == 모든 phase duration 합 — 안 맞으면 뒤쪽 phase가 절대 안 켜지는 버그
        int summedDuration = signal.phases.stream().mapToInt(p -> p.duration).sum();
        assertEquals(signal.cycle, summedDuration, "cycle은 phase duration 합과 항상 일치해야 함");

        // turnId -> fromLink 매핑 (connKeyToTurn: "nodeId_fromLink_toLink" -> turnId)
        Map<String, Long> turnIdToFromLink = new HashMap<>();
        for (var e2 : ctx.connKeyToTurn.entrySet()) {
            String[] parts = e2.getKey().split("_");
            if (!e2.getValue().isEmpty()) turnIdToFromLink.put(e2.getValue(), Long.parseLong(parts[1]));
        }

        // 그룹당 green+yellow 두 PhaseInfo가 같은 activeTurns를 가지므로(페이즈 구간 표시용
        // duration만 다름) Set으로 모아 자연히 그룹 단위로만 셈
        Set<Set<Long>> greenPhaseApproaches = new HashSet<>();
        for (var phase : signal.phases) {
            if (phase.activeTurns.isEmpty()) continue;
            Set<Long> fromLinks = new HashSet<>();
            for (String tid : phase.activeTurns) {
                Long fl = turnIdToFromLink.get(tid);
                if (fl != null) fromLinks.add(fl);
            }
            if (fromLinks.size() > 0) greenPhaseApproaches.add(fromLinks);
        }

        assertEquals(2, greenPhaseApproaches.size(), "녹색 phase는 정확히 2개(N-S 쌍, E-W 쌍)여야 함");
        for (Set<Long> phaseLinks : greenPhaseApproaches) {
            assertEquals(2, phaseLinks.size(), "각 phase는 마주보는 접근로 2개를 포함해야 함: " + phaseLinks);
            boolean isNS = phaseLinks.equals(Set.of(500001L, 500003L));
            boolean isEW = phaseLinks.equals(Set.of(500002L, 500004L));
            assertTrue(isNS || isEW, "직교하는 접근로끼리 묶이면 안 됨: " + phaseLinks);
        }
    }

    /**
     * "TOD가 신호 더미 데이터와 정말 잘 매핑되는가"를 직접 검증 — {@link #generated_signal_produces_valid_default_tod_via_scaffolder}
     * 등 기존 테스트는 signalTodValid로 "노드 집합이 일치하는지"만 보는데, 그건 TOD가
     * 참조하는 plan id가 실제로 그 노드의 signal.xml에 존재하는지까지는 보장 안 한다.
     * 여기서는 정규식으로 signal.xml/TOD를 각각 독립적으로 파싱해 교차검증한다:
     *   1) TOD가 참조하는 (nodeId, planId) 쌍이 전부 signal.xml에 실재하는 plan인지
     *   2) 하루(00:00~24:00)가 빈틈·중복 없이 정확히 타일링되는지
     */
    @Test
    void tod_plan_references_exactly_match_signal_dummy_data() {
        NetworkXml network = networkWith(intersectionNode(10000001L), intersectionNode(10000002L));
        String signalXml = generator.generateSignalXml(network);
        Set<String> planNodes = NextSimInputScaffolder.extractSignalPlanNodeIds(signalXml);
        String tod = NextSimInputScaffolder.buildDefaultSignalTod(signalXml, planNodes);

        // signal.xml: nodeId -> 실제 존재하는 plan id 집합 (독립적인 정규식 파싱)
        Map<String, Set<Integer>> signalPlansByNode = new HashMap<>();
        Matcher sigNodeM = Pattern.compile("<node id=\"([^\"]+)\">(.*?)</node>", Pattern.DOTALL).matcher(signalXml);
        while (sigNodeM.find()) {
            String nodeId = sigNodeM.group(1);
            Set<Integer> plans = new HashSet<>();
            Matcher planM = Pattern.compile("<plan id=\"(\\d+)\"").matcher(sigNodeM.group(2));
            while (planM.find()) plans.add(Integer.parseInt(planM.group(1)));
            signalPlansByNode.put(nodeId, plans);
        }
        assertEquals(2, signalPlansByNode.size());
        for (Set<Integer> plans : signalPlansByNode.values()) {
            assertEquals(Set.of(0, 1), plans, "각 신호 노드는 plan 0/1을 정확히 둘 다 가져야 함");
        }

        // TOD: nodeId -> [(planId, startTime, endTime), ...] (독립적인 정규식 파싱)
        Matcher todNodeM = Pattern.compile("<node id=\"([^\"]+)\">(.*?)</node>", Pattern.DOTALL).matcher(tod);
        int nodesChecked = 0;
        while (todNodeM.find()) {
            String nodeId = todNodeM.group(1);
            Set<Integer> validPlans = signalPlansByNode.get(nodeId);
            assertNotNull(validPlans, "TOD가 signal.xml에 없는 노드를 참조함: " + nodeId);

            List<int[]> windows = new ArrayList<>(); // [startMin, endMin, planId]
            Matcher planM = Pattern.compile(
                    "<plan id=\"(\\d+)\" startTime=\"(\\d\\d):(\\d\\d):00\" endTime=\"(\\d\\d):(\\d\\d):00\"/>")
                    .matcher(todNodeM.group(2));
            while (planM.find()) {
                int planId = Integer.parseInt(planM.group(1));
                assertTrue(validPlans.contains(planId),
                        "TOD가 노드 " + nodeId + "에 대해 signal.xml에 없는 plan " + planId + "을 참조함");
                int start = Integer.parseInt(planM.group(2)) * 60 + Integer.parseInt(planM.group(3));
                int end = Integer.parseInt(planM.group(4)) * 60 + Integer.parseInt(planM.group(5));
                windows.add(new int[]{start, end, planId});
            }
            assertFalse(windows.isEmpty(), "노드 " + nodeId + "에 TOD 구간이 하나도 없음");

            // 하루가 빈틈·중복 없이 타일링되는지 (시간순 정렬 후 인접 구간이 정확히 맞물리는지)
            windows.sort(Comparator.comparingInt(w -> w[0]));
            assertEquals(0, windows.get(0)[0], "첫 구간은 00:00부터 시작해야 함: " + nodeId);
            assertEquals(24 * 60, windows.get(windows.size() - 1)[1], "마지막 구간은 24:00에 끝나야 함: " + nodeId);
            for (int i = 1; i < windows.size(); i++) {
                assertEquals(windows.get(i - 1)[1], windows.get(i)[0],
                        "구간 사이에 빈틈/중복이 있으면 안 됨(노드 " + nodeId + "): "
                        + windows.get(i - 1)[1] + " != " + windows.get(i)[0]);
            }
            nodesChecked++;
        }
        assertEquals(2, nodesChecked, "signal.xml의 두 신호 노드가 TOD에 전부 매핑돼야 함");
    }

    @Test
    void default_tod_uses_realistic_am_pm_peak_schedule_when_both_plans_exist() {
        NetworkXml network = networkWith(intersectionNode(10000001L));
        String signalXml = generator.generateSignalXml(network);
        Set<String> planNodes = NextSimInputScaffolder.extractSignalPlanNodeIds(signalXml);

        String tod = NextSimInputScaffolder.buildDefaultSignalTod(signalXml, planNodes);

        assertTrue(NextSimInputScaffolder.signalTodValid(tod, planNodes));
        // 출퇴근 러시아워(plan 1)와 그 외(plan 0)가 나뉘어 있어야 함 — 하루 종일 같은 플랜이면
        // TOD 개념 자체가 무의미해짐
        assertTrue(tod.contains("<plan id=\"1\" startTime=\"07:00:00\" endTime=\"09:00:00\"/>"), "오전 출근 피크");
        assertTrue(tod.contains("<plan id=\"1\" startTime=\"17:00:00\" endTime=\"19:00:00\"/>"), "오후 퇴근 피크");
        assertTrue(tod.contains("<plan id=\"0\" startTime=\"09:00:00\" endTime=\"17:00:00\"/>"), "낮 시간대는 평시");
        assertFalse(tod.contains("startTime=\"00:00:00\" endTime=\"24:00:00\""), "종일 단일 플랜이면 안 됨");
    }

    // ── 스트리밍 생성(generateSignalXmlStreaming) — 대형 bbox 임포트 경로 ──────────────

    private static String toNodeXmlFragment(NodeXml node) {
        StringBuilder sb = new StringBuilder("<node id=\"" + node.getId() + "\" type=\"intersection\" num_port=\"0\" num_connection=\""
                + node.getConnections().size() + "\">");
        for (ConnectionXml c : node.getConnections()) {
            sb.append("<connection id=\"").append(c.getId())
              .append("\" from_link=\"").append(c.getFromLink())
              .append("\" to_link=\"").append(c.getToLink())
              .append("\" turning=\"").append(c.getTurning() == Turning.Right_Turn ? "R"
                      : c.getTurning() == Turning.Left_Turn ? "L" : "S")
              .append("\" length=\"0\" width=\"0\" ff_spd=\"0\"/>");
        }
        return sb.append("</node>").toString();
    }

    /** 실제 network.xml 형태를 손으로 구성 — <link>는 lanes까지 포함해 "읽지 않고 스킵"을 검증 */
    private static String fakeNetworkXml(String... nodeFragments) {
        StringBuilder sb = new StringBuilder("<?xml version='1.0' encoding='UTF-8'?><Network id=\"0\">");
        sb.append("<nodes>");
        for (String n : nodeFragments) sb.append(n);
        sb.append("</nodes>");
        // 링크 블록 — 신호 생성과 무관하지만 스트리밍 스캐너가 안전하게 스킵하는지 검증용으로 포함
        sb.append("<links><link id=\"20000100\" from_node=\"1\" to_node=\"2\" num_lane=\"1\" length=\"10\" width=\"3.5\"")
          .append(" max_spd=\"30\" min_spd=\"0\" ff_spd=\"30\" wave_spd=\"5\" qmax=\"1800\" max_veh=\"1\" sim_type=\"0\"")
          .append(" type=\"straight\" stop_line=\"0\"><lane id=\"0\" link_ref=\"20000100\" num_cell=\"1\">")
          .append("<segment id=\"0\" block=\"false\" init_point=\"0\" end_point=\"10\"/></lane></link></links>");
        return sb.append("</Network>").toString();
    }

    @Test
    void streaming_generation_matches_inmemory_generation() throws Exception {
        NodeXml node = intersectionNode(10000001L);
        NetworkXml network = networkWith(node);
        String inMemoryXml = generator.generateSignalXml(network);

        String networkXmlText = fakeNetworkXml(toNodeXmlFragment(node));
        String streamedXml = generator.generateSignalXmlStreaming(
                networkXmlText.getBytes(java.nio.charset.StandardCharsets.UTF_8));

        assertEquals(NextSimInputScaffolder.extractSignalPlanNodeIds(inMemoryXml),
                NextSimInputScaffolder.extractSignalPlanNodeIds(streamedXml),
                "인메모리 방식과 스트리밍 방식이 같은 노드 집합에 신호를 생성해야 함");
        assertTrue(streamedXml.contains("<plan id=\"0\" cycle=\"46\""));
        assertTrue(streamedXml.contains("<plan id=\"1\" cycle=\"66\""));
    }

    @Test
    void streaming_generation_skips_deadend_and_link_blocks() throws Exception {
        NodeXml deadEnd = new NodeXml();
        deadEnd.setId(20000001L);
        deadEnd.setConnections(List.of(conn(1, 100, 200, Turning.Straight)));

        String networkXmlText = fakeNetworkXml(toNodeXmlFragment(deadEnd));
        String streamedXml = generator.generateSignalXmlStreaming(
                networkXmlText.getBytes(java.nio.charset.StandardCharsets.UTF_8));

        assertTrue(NextSimInputScaffolder.extractSignalPlanNodeIds(streamedXml).isEmpty(),
                "접근 1개뿐인 막다른 길은 스트리밍 경로에서도 신호가 생성되면 안 됨");
    }

    @Test
    void streaming_generation_multiple_nodes_all_processed() throws Exception {
        NodeXml n1 = intersectionNode(10000001L);
        NodeXml n2 = intersectionNode(10000002L);
        String networkXmlText = fakeNetworkXml(toNodeXmlFragment(n1), toNodeXmlFragment(n2));

        String streamedXml = generator.generateSignalXmlStreaming(
                networkXmlText.getBytes(java.nio.charset.StandardCharsets.UTF_8));

        assertEquals(Set.of("10000001", "10000002"), NextSimInputScaffolder.extractSignalPlanNodeIds(streamedXml));
    }
}
