package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * 네트워크 XML의 교차로 구조를 분석해 더미 신호 컨텍스트를 생성한다.
 *
 * <ul>
 *   <li>접근 방향(fromLink)이 2개 이상인 노드만 신호 노드로 처리</li>
 *   <li>우회전(R)은 RTOR(상시허용) → 언제나 통과</li>
 *   <li>직진/좌회전은 접근 방향을 짝수/홀수 그룹으로 묶어 2페이즈 교차 운영</li>
 *   <li>사이클 120초, 황색 3초, 녹색 시간은 페이즈 수에 따라 균등 배분</li>
 * </ul>
 */
@Component
public class DummySignalGenerator {

    private static final Logger log = LoggerFactory.getLogger(DummySignalGenerator.class);

    private static final int CYCLE         = 120; // 기본 사이클 (초)
    private static final int YELLOW        = 3;   // 황색 신호 (초)
    private static final int MIN_GREEN     = 15;  // 최소 녹색 시간 (초)

    /**
     * NetworkXml을 분석해 DummyVehicleGenerator.SignalContext를 반환한다.
     *
     * @param network   파싱된 네트워크 XML
     * @param linkToNode 이미 구축된 linkId → toNodeId 맵
     */
    public DummyVehicleGenerator.SignalContext generate(
            NetworkXml network,
            Map<String, String> linkToNode) {

        Map<String, DummyVehicleGenerator.NodeSignalInfo> nodeSignals = new HashMap<>();
        Map<String, String> connKeyToTurn = new HashMap<>();

        if (network.getNodes() == null) {
            return DummyVehicleGenerator.SignalContext.empty();
        }

        int signalNodeCount = 0;

        for (NodeXml node : network.getNodes()) {
            if (node.getConnections() == null || node.getConnections().isEmpty()) continue;

            String nodeId = String.valueOf(node.getId());

            // 접근 방향별 연결 그룹핑 (fromLink → connections)
            Map<Long, List<ConnectionXml>> approachMap = new LinkedHashMap<>();
            for (ConnectionXml conn : node.getConnections()) {
                if (conn.getFromLink() == null || conn.getToLink() == null) continue;
                approachMap.computeIfAbsent(conn.getFromLink(), k -> new ArrayList<>()).add(conn);
            }

            // 접근 방향이 1개 이하면 신호 불필요 (통과 노드)
            if (approachMap.size() <= 1) continue;

            List<Long> approaches = new ArrayList<>(approachMap.keySet());

            // ── turn 할당 ─────────────────────────────────────────────
            // RTOR: 우회전은 connKeyToTurn에 "" 매핑 (항상 통과)
            // 비RTOR: 접근 방향당 하나의 turnId 부여
            Map<Long, String> approachToTurnId = new LinkedHashMap<>();
            int turnIdx = 0;

            for (Long fromLink : approaches) {
                List<ConnectionXml> conns = approachMap.get(fromLink);
                String fromLinkStr = String.valueOf(fromLink);

                for (ConnectionXml conn : conns) {
                    String toLinkStr = String.valueOf(conn.getToLink());
                    String key = nodeId + "_" + fromLinkStr + "_" + toLinkStr;

                    if (conn.getTurning() == Turning.Right_Turn) {
                        // 우회전 → RTOR, 항상 통과
                        connKeyToTurn.put(key, "");
                    } else {
                        // 직진/좌회전 → 접근 방향에 공통 turnId 부여
                        if (!approachToTurnId.containsKey(fromLink)) {
                            approachToTurnId.put(fromLink, "t" + turnIdx++);
                        }
                        connKeyToTurn.put(key, approachToTurnId.get(fromLink));
                    }
                }
            }

            if (approachToTurnId.isEmpty()) continue; // 모두 RTOR이면 신호 불필요

            // ── 페이즈 구성 ───────────────────────────────────────────
            // 접근 방향을 짝수/홀수 인덱스 2개 그룹으로 묶어 교차 운영
            // (반대편 직진끼리 동시 녹색 — 표준 2페이즈 신호)
            List<String> groupA = new ArrayList<>();
            List<String> groupB = new ArrayList<>();

            List<Long> orderedApproaches = new ArrayList<>(approachToTurnId.keySet());
            for (int i = 0; i < orderedApproaches.size(); i++) {
                String tid = approachToTurnId.get(orderedApproaches.get(i));
                if (i % 2 == 0) groupA.add(tid);
                else             groupB.add(tid);
            }

            List<DummyVehicleGenerator.PhaseInfo> phases = new ArrayList<>();

            if (groupB.isEmpty()) {
                // 접근 방향이 1개 그룹만 있는 경우 (T자 등) → 단일 페이즈
                phases.add(new DummyVehicleGenerator.PhaseInfo(CYCLE, new HashSet<>(groupA)));
            } else {
                // 녹색 시간 균등 배분: (사이클 - 황색×2) / 2
                int greenTime = Math.max(MIN_GREEN, (CYCLE - YELLOW * 2) / 2);

                // 페이즈 A: 그룹A 녹색
                phases.add(new DummyVehicleGenerator.PhaseInfo(greenTime, new HashSet<>(groupA)));
                // 황색
                phases.add(new DummyVehicleGenerator.PhaseInfo(YELLOW, new HashSet<>(groupA)));
                // 페이즈 B: 그룹B 녹색
                phases.add(new DummyVehicleGenerator.PhaseInfo(greenTime, new HashSet<>(groupB)));
                // 황색
                phases.add(new DummyVehicleGenerator.PhaseInfo(YELLOW, new HashSet<>(groupB)));
            }

            // offset: 노드 ID 기반 분산 (모든 신호가 동시에 바뀌는 현상 방지)
            int offset = (int)(node.getId() % CYCLE);

            nodeSignals.put(nodeId, new DummyVehicleGenerator.NodeSignalInfo(CYCLE, offset, phases));
            signalNodeCount++;
        }

        log.info("[DummySignalGenerator] 더미 신호 생성 완료: 신호 노드 {}개, connKey 매핑 {}개",
                signalNodeCount, connKeyToTurn.size());

        return new DummyVehicleGenerator.SignalContext(nodeSignals, linkToNode, connKeyToTurn);
    }

    /**
     * {@link #generate}와 같은 규칙(접근 방향 2개 이상인 노드만 신호 노드로, 우회전은
     * RTOR로 상시 허용, 나머지 접근을 짝/홀 그룹으로 묶어 2페이즈 교차 운영)으로 실제
     * signal.xml 텍스트를 생성한다. KTDB 등 임포트 직후 신호 데이터가 아예 없을 때 빈
     * 템플릿 대신 이 결과로 채워, {@code buildSampleOdMatrix}와 동일하게 "신호 메뉴에서
     * 다듬을 수 있는 시작점"을 제공한다(신호 유무 무결성 검사를 통과시키는 것이 목적).
     *
     * <p>RTOR 턴은 항상 통과이므로 모든 페이즈의 turnList에 포함시킨다(실측 배포판
     * signal.xml 관례와 동일 — RTOR turn id가 모든 phase에 등장함).
     */
    public String generateSignalXml(NetworkXml network) {
        StringBuilder body = new StringBuilder();
        int signalNodeCount = 0;

        if (network.getNodes() != null) {
            for (NodeXml node : network.getNodes()) {
                if (node.getConnections() == null || node.getConnections().isEmpty()) continue;

                Map<Long, List<ConnectionXml>> approachMap = new LinkedHashMap<>();
                for (ConnectionXml conn : node.getConnections()) {
                    if (conn.getFromLink() == null || conn.getToLink() == null) continue;
                    approachMap.computeIfAbsent(conn.getFromLink(), k -> new ArrayList<>()).add(conn);
                }
                if (approachMap.size() <= 1) continue;

                Map<Long, String> approachToTurnId = new LinkedHashMap<>();
                Map<String, List<String>> turnConnIds = new LinkedHashMap<>(); // turnId → connection id 목록
                List<String> rtorConnIds = new ArrayList<>();
                int turnIdx = 0;

                for (Long fromLink : approachMap.keySet()) {
                    for (ConnectionXml conn : approachMap.get(fromLink)) {
                        String connId = String.valueOf(conn.getId());
                        if (conn.getTurning() == Turning.Right_Turn) {
                            rtorConnIds.add(connId);
                            continue;
                        }
                        if (!approachToTurnId.containsKey(fromLink)) {
                            approachToTurnId.put(fromLink, "t" + turnIdx++);
                        }
                        String tid = approachToTurnId.get(fromLink);
                        turnConnIds.computeIfAbsent(tid, k -> new ArrayList<>()).add(connId);
                    }
                }
                if (approachToTurnId.isEmpty()) continue; // 전부 RTOR → 신호 불필요

                List<Long> orderedApproaches = new ArrayList<>(approachToTurnId.keySet());
                List<String> groupA = new ArrayList<>(), groupB = new ArrayList<>();
                for (int i = 0; i < orderedApproaches.size(); i++) {
                    String tid = approachToTurnId.get(orderedApproaches.get(i));
                    (i % 2 == 0 ? groupA : groupB).add(tid);
                }

                // turn 요소: RTOR 먼저(고정 id "r0","r1"...), 그다음 t0,t1... — xml id는 순번 재부여
                StringBuilder turnsXml = new StringBuilder();
                Map<String, String> turnKeyToXmlId = new LinkedHashMap<>();
                int xmlTurnSeq = 0;
                List<String> rtorXmlIds = new ArrayList<>();
                if (!rtorConnIds.isEmpty()) {
                    String xmlId = String.valueOf(xmlTurnSeq++);
                    rtorXmlIds.add(xmlId);
                    turnsXml.append("      <turn id=\"").append(xmlId)
                            .append("\" turning=\"R\" type=\"RTOR\" connList=\"")
                            .append(String.join(" ", rtorConnIds)).append("\"/>\n");
                }
                for (Map.Entry<String, List<String>> e : turnConnIds.entrySet()) {
                    String xmlId = String.valueOf(xmlTurnSeq++);
                    turnKeyToXmlId.put(e.getKey(), xmlId);
                    turnsXml.append("      <turn id=\"").append(xmlId)
                            .append("\" turning=\"S\" type=\"None\" connList=\"")
                            .append(String.join(" ", e.getValue())).append("\"/>\n");
                }

                int greenTime = Math.max(MIN_GREEN, (CYCLE - YELLOW * 2) / 2);
                StringBuilder phasesXml = new StringBuilder();
                int phaseId = 0;
                if (groupB.isEmpty()) {
                    phasesXml.append(phaseXml(phaseId, CYCLE, groupA, turnKeyToXmlId, rtorXmlIds, true));
                } else {
                    phasesXml.append(phaseXml(phaseId++, greenTime, groupA, turnKeyToXmlId, rtorXmlIds, true));
                    phasesXml.append(phaseXml(phaseId++, YELLOW, groupA, turnKeyToXmlId, rtorXmlIds, false));
                    phasesXml.append(phaseXml(phaseId++, greenTime, groupB, turnKeyToXmlId, rtorXmlIds, true));
                    phasesXml.append(phaseXml(phaseId, YELLOW, groupB, turnKeyToXmlId, rtorXmlIds, false));
                }

                int offset = (int) (node.getId() % CYCLE);
                body.append("  <node id=\"").append(node.getId()).append("\">\n")
                        .append("    <turnList>\n").append(turnsXml).append("    </turnList>\n")
                        .append("    <planList>\n")
                        .append("      <plan id=\"0\" cycle=\"").append(CYCLE).append("\" offset=\"").append(offset).append("\">\n")
                        .append(phasesXml)
                        .append("      </plan>\n")
                        .append("    </planList>\n")
                        .append("  </node>\n");
                signalNodeCount++;
            }
        }

        log.info("[DummySignalGenerator] signal.xml 자동 생성: 신호 노드 {}개", signalNodeCount);
        return "<?xml version='1.0' encoding='UTF-8'?>\n" +
                "<!-- 네트워크 가져오기 시 자동 생성된 샘플 신호입니다. 신호 메뉴에서 수정하세요. -->\n" +
                "<Signal id=\"0\">\n" + body + "</Signal>\n";
    }

    private static String phaseXml(int phaseId, int duration, List<String> activeTurnKeys,
                                    Map<String, String> turnKeyToXmlId, List<String> rtorXmlIds, boolean isGreen) {
        List<String> xmlIds = new ArrayList<>(rtorXmlIds); // RTOR는 모든 페이즈에서 상시 허용
        for (String key : activeTurnKeys) xmlIds.add(turnKeyToXmlId.get(key));
        String turnListAttr = String.join(" ", xmlIds);
        StringBuilder sb = new StringBuilder()
                .append("      <phase id=\"").append(phaseId).append("\" duration=\"").append(duration)
                .append("\" turnList=\"").append(turnListAttr).append("\"");
        if (isGreen) {
            sb.append(" minGreenTime=\"").append(MIN_GREEN).append("\" maxGreenTime=\"").append(CYCLE - YELLOW * 2).append("\"");
        }
        return sb.append("/>\n").toString();
    }
}
