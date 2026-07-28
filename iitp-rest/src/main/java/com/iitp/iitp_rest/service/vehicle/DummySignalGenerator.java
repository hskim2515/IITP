package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.service.network.OsmTrafficSignalMatcher;
import com.iitp.iitp_rest.service.network.OsmTrafficSignalRepository;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Unmarshaller;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 네트워크 XML의 교차로 구조를 분석해 더미 신호 컨텍스트를 생성한다.
 *
 * <ul>
 *   <li>접근 방향(fromLink)이 2개 이상인 노드만 신호 노드로 처리</li>
 *   <li>우회전(R)은 RTOR(상시허용) → 언제나 통과</li>
 *   <li>직진/좌회전은 접근로의 실제 좌표(node의 center, link의 from/to_node)로 방위각을
 *       계산해, 서로 마주보는(≈180도) 접근로끼리 묶어 동시 녹색을 주는 표준 2페이즈로
 *       운영한다. 방위각을 계산할 좌표가 없거나 마주보는 짝을 못 찾은 접근로는 단독
 *       페이즈로 남긴다(잘못 페어링해 직교하는 접근로가 동시 녹색이 되는 것보다 항상 안전).</li>
 *   <li>황색 3초, 페이즈(그룹)당 녹색 시간(평시/혼잡)만큼 순환 — 사이클 길이는 페이즈 수에 비례</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class DummySignalGenerator {

    private static final Logger log = LoggerFactory.getLogger(DummySignalGenerator.class);

    // 실측(부천 참조 데이터): 커넥션이 있는 노드 104개 중 실제 신호가 있는 노드는 18개뿐 —
    // 나머지 86개는 무신호 우선순위 교차로다("접근로 2개 이상"이라는 조건만으로는 신호
    // 필요 여부를 못 가른다). OSM의 실제 highway=traffic_signals 태그로 "여기 진짜 신호등이
    // 있다"를 확인해, 그 위치 근처에서만 신호를 생성하도록 게이팅한다. 데이터가 아직
    // 임포트 안 됐으면(hasData()==false) 이 게이트를 건너뛰고 기존 동작(접근로 2개 이상이면
    // 생성) 그대로 — 회귀 방지.
    private final OsmTrafficSignalRepository osmTrafficSignalRepository;

    private static final int CYCLE         = 120; // 기본 사이클 (초) — generate()(차량 CZML용)가 사용
    private static final int YELLOW        = 3;   // 황색 신호 (초)
    private static final int MIN_GREEN     = 15;  // 최소 녹색 시간 (초)

    // ── signal.xml 텍스트 생성 전용(generateSignalXml/generateSignalXmlStreaming) ──
    // 평시(plan 0)와 출퇴근 혼잡시간대(plan 1) 두 플랜을 만들어 signalTOD가 실제 신호
    // 운영처럼 시간대별로 다른 신호를 쓸 수 있게 한다 — 플랜이 하나뿐이면 TOD가 아무리
    // 시간대를 나눠도 결국 종일 같은 신호일 뿐이라, 사실상 TOD 개념 자체가 무의미해진다.
    //
    // 페이즈 구성: 접근로 좌표로 방위각을 계산해 마주보는(≈180도) 접근로끼리 페어를 지어
    // 동시 녹색(=표준 2페이즈 신호)을 준다. 예전엔 접근로를 그냥 데이터 나열 순서로 임의로
    // 둘로 갈라 동시 운영했는데, 실제로는 마주보지 않는(직교하는) 두 접근로가 우연히 같은
    // 그룹에 묶여 동시 녹색이 될 수 있어 현실이었다면 충돌이 나는 조합이었다 — 사용자가
    // 정확히 이 문제("양쪽에서 파란불이면 사고 나잖아")를 지적해 방위각 기반 페어링으로
    // 바꿨다. 방위각을 계산 못 하는 접근로(좌표 데이터 누락 등)는 페어링을 포기하고 단독
    // 페이즈로 돌린다 — 틀린 페어링보다 단독 운영(용량은 낮지만 항상 안전)이 낫다.
    private static final int GREEN_OFFPEAK = 20; // 평시 페이즈(그룹)당 녹색 시간(초)
    private static final int GREEN_PEAK    = 30; // 혼잡시간대 페이즈(그룹)당 녹색 시간(초) — 처리용량 확보
    private static final double OPPOSITE_BEARING_TOLERANCE_DEG = 30; // 방위각差가 180±이 값 이내면 "마주보는 방향"으로 간주

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

        Geometry geo = Geometry.fromNetwork(network);
        OsmTrafficSignalMatcher osmMatcher = buildOsmMatcher();
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

            // OSM 신호등 게이트 — buildNodeSignalBlockOrNull과 동일 근거(실측: 부천 참조데이터
            // 커넥션노드 104개 중 신호 18개뿐). 이 메서드는 signal.xml 파싱 실패 시의 CZML
            // 폴백이라 buildNodeSignalBlockOrNull과 별개 코드경로이므로 동일 게이트를 중복 적용.
            if (osmMatcher != null && node.getId() != null) {
                double[] wgs = geo.nodeWgs84(node.getId());
                if (wgs != null && !osmMatcher.hasSignalNear(wgs[0], wgs[1])) continue;
            }

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
            // generateSignalXml과 동일한 방위각 기반 페어링(마주보는 접근로끼리 동시 녹색,
            // 짝을 못 찾으면 단독 페이즈) — 예전엔 여기만 짝/홀 인덱스로 임의로 갈라 묶었는데,
            // 그러면 signal.xml(실제 NextSim 입력)은 안전한 페어링을 쓰는데 이 차량 CZML
            // 미리보기(더미 차량이 어느 신호에서 서는지)만 다른 규칙을 써서 두 결과가 어긋났다
            // (buildSignalContext가 signal.xml 파싱에 실패했을 때만 폴백으로 여기로 옴 —
            // VehicleController 참고).
            List<List<String>> phaseGroups = groupApproachesByOppositeBearing(approachToTurnId, geo, node.getId());

            // 페이즈(그룹)당 목표 녹색 시간 — 그룹이 2개(표준 페어링)면 예전과 동일하게
            // (CYCLE - 황색×2)/2, 그룹이 더 많으면(페어링 실패, 라운드로빈 폴백) 그룹 수에 맞춰
            // 균등 배분. 사이클은 실제 페이즈 합과 항상 같도록 그룹 수에서 역산한다(고정 CYCLE에
            // 억지로 맞추면 그룹이 많을 때 뒤쪽 페이즈가 사이클 밖으로 밀려 영원히 녹색이 안
            // 되는 경우가 생길 수 있음).
            int n = phaseGroups.size();
            int greenTime = n <= 1 ? CYCLE : Math.max(MIN_GREEN, (CYCLE - YELLOW * n) / n);
            int cycle = n <= 1 ? CYCLE : n * (greenTime + YELLOW);

            List<DummyVehicleGenerator.PhaseInfo> phases = new ArrayList<>();
            for (List<String> group : phaseGroups) {
                phases.add(new DummyVehicleGenerator.PhaseInfo(greenTime, new HashSet<>(group)));
                if (n > 1) phases.add(new DummyVehicleGenerator.PhaseInfo(YELLOW, new HashSet<>(group)));
            }

            // offset: 노드 ID 기반 분산 (모든 신호가 동시에 바뀌는 현상 방지)
            int offset = (int)(node.getId() % cycle);

            nodeSignals.put(nodeId, new DummyVehicleGenerator.NodeSignalInfo(cycle, offset, phases));
            signalNodeCount++;
        }

        log.info("[DummySignalGenerator] 더미 신호 생성 완료: 신호 노드 {}개, connKey 매핑 {}개",
                signalNodeCount, connKeyToTurn.size());

        return new DummyVehicleGenerator.SignalContext(nodeSignals, linkToNode, connKeyToTurn);
    }

    /**
     * 접근 방향 2개 이상인 노드만 신호 노드로 처리하고, 우회전은 RTOR로 상시 허용,
     * 나머지 접근은 하나씩 순서대로 단독 녹색을 주는 라운드로빈으로 운영해 실제
     * signal.xml 텍스트를 생성한다({@link #generate}는 별개 기능(차량 CZML 미리보기용)
     * 이라 이 규칙 변경과 무관). KTDB 등 임포트 직후 신호 데이터가 아예 없을 때 빈
     * 템플릿 대신 이 결과로 채워, {@code buildSampleOdMatrix}와 동일하게 "신호 메뉴에서
     * 다듬을 수 있는 시작점"을 제공한다(신호 유무 무결성 검사를 통과시키는 것이 목적).
     *
     * <p>RTOR 턴은 항상 통과이므로 모든 페이즈의 turnList에 포함시킨다(실측 배포판
     * signal.xml 관례와 동일 — RTOR turn id가 모든 phase에 등장함). 노드당 평시(plan 0)/
     * 혼잡시간대(plan 1) 두 플랜을 만들어, signalTOD가 출퇴근 시간대를 다르게 운영할 수
     * 있게 한다({@code NextSimInputScaffolder.buildDefaultSignalTod} 참고).
     */
    public String generateSignalXml(NetworkXml network) {
        Geometry geo = Geometry.fromNetwork(network);
        OsmTrafficSignalMatcher osmMatcher = buildOsmMatcher();
        StringBuilder body = new StringBuilder();
        int signalNodeCount = 0;
        int skippedNodeCount = 0;

        if (network.getNodes() != null) {
            for (NodeXml node : network.getNodes()) {
                // 노드 하나의 결함(예상 못 한 데이터 값 등)이 나머지 전체 신호 생성을 죽이지
                // 않도록 격리 — generateSignalXmlStreaming과 동일 원칙(아래 주석 참고).
                try {
                    String block = buildNodeSignalBlockOrNull(node, geo, osmMatcher);
                    if (block == null) continue;
                    body.append(block);
                    signalNodeCount++;
                } catch (Exception e) {
                    skippedNodeCount++;
                    log.warn("[DummySignalGenerator] 노드 {} 신호 생성 실패(건너뜀): {}", node.getId(), e.toString());
                }
            }
        }

        if (skippedNodeCount > 0) {
            log.warn("[DummySignalGenerator] signal.xml 자동 생성 중 {}개 노드 건너뜀(개별 실패)", skippedNodeCount);
        }
        log.info("[DummySignalGenerator] signal.xml 자동 생성: 신호 노드 {}개", signalNodeCount);
        return wrapSignalXml(body);
    }

    /**
     * 대형(스트리밍) 임포트 경로용 — network.xml을 통째로 JAXB 객체화하지 않고 두 번
     * 스캔한다: 1차는 {@code <node>}의 {@code center}와 {@code <link>}의
     * {@code from_node}/{@code to_node} 속성만(태그 자체만, lanes/cells 본문은 안 읽음)
     * 뽑아 방위각 계산용 좌표 맵을 만들고, 2차는 기존과 동일하게 {@code <node>...</node>}
     * 블록만 하나씩 JAXB로 파싱해 1차에서 만든 좌표로 방위각 기반 신호를 생성한다
     * ({@link com.iitp.iitp_rest.service.network.NetworkStreamingDiffService}와 동일한,
     * 노드/링크가 자기 태그를 중첩하지 않는다는 스키마 전제로 이미 검증된 블록 스캔 기법
     * 재사용). 호출부가 이미 파일 전체를 {@code byte[]}로 들고 있으므로(SFTP에서 읽은
     * 그대로) 두 번 스캔해도 추가 메모리 비용은 스트림 래퍼 두 개뿐이다 — lanes/cells를
     * 포함한 전체 JAXB 객체 그래프를 메모리에 올리는 것과는 비교가 안 되게 가볍다(대형망
     * OOM 회피 — KtdbStreamingConverter가 정확히 이 이유로 스트리밍 경로를 쓰는 것과 동일
     * 원칙).
     */
    public String generateSignalXmlStreaming(byte[] networkXmlBytes) throws Exception {
        Geometry geo = scanGeometry(new ByteArrayInputStream(networkXmlBytes));
        OsmTrafficSignalMatcher osmMatcher = buildOsmMatcher();

        StringBuilder body = new StringBuilder();
        int[] signalNodeCount = {0};
        int[] skippedNodeCount = {0};
        JAXBContext jaxb = JAXBContext.newInstance(NodeXml.class);

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(new ByteArrayInputStream(networkXmlBytes), StandardCharsets.UTF_8), 1 << 20)) {
            StringBuilder tag = null;
            int c;
            while ((c = reader.read()) >= 0) {
                char ch = (char) c;
                if (tag == null) {
                    if (ch == '<') tag = new StringBuilder("<");
                    continue;
                }
                tag.append(ch);
                if (ch != '>') continue;
                String t = tag.toString();
                tag = null;

                if (t.startsWith("<node ")) {
                    if (t.endsWith("/>")) continue; // self-closing = 포트/커넥션 없음 → 신호 불필요
                    String block = t + readUntilClose(reader, "</node>");
                    // ⚠️ 실측: 대형 실제 KTDB망(4만+ 노드)에서 특정 노드 하나만 예외(JAXB 파싱 실패,
                    // 예상 못 한 enum 값 등)를 던져도 예전엔 그 예외가 스트림 스캔 전체를 중단시켜
                    // 이미 처리한 노드까지 통째로 버려졌다 — 그 결과 신호가 "전혀" 생성되지 않은
                    // 것처럼 보였다(KtdbImportController가 이 예외를 잡아 로그 경고만 남기고 조용히
                    // 빈 템플릿/기존 파일로 폴백하기 때문에 사용자에게는 아무 에러도 안 보임).
                    // 노드 하나의 결함이 나머지 수만 개의 정상 노드 신호까지 죽이면 안 되므로,
                    // 노드 단위로 격리해 실패한 노드만 건너뛴다.
                    try {
                        NodeXml node = unmarshalNodeFragment(jaxb, block);
                        String nodeBlock = buildNodeSignalBlockOrNull(node, geo, osmMatcher);
                        if (nodeBlock != null) { body.append(nodeBlock); signalNodeCount[0]++; }
                    } catch (Exception e) {
                        skippedNodeCount[0]++;
                        log.warn("[DummySignalGenerator] 노드 신호 생성 실패(건너뜀): {}", e.toString());
                    }
                } else if (t.startsWith("<link ") && !t.endsWith("/>")) {
                    readUntilClose(reader, "</link>"); // 신호 생성에 불필요 — 내용을 읽지 않고 스킵
                }
            }
        }

        if (skippedNodeCount[0] > 0) {
            log.warn("[DummySignalGenerator] signal.xml 스트리밍 생성 중 {}개 노드 건너뜀(개별 실패)", skippedNodeCount[0]);
        }
        log.info("[DummySignalGenerator] signal.xml 스트리밍 생성: 신호 노드 {}개", signalNodeCount[0]);
        return wrapSignalXml(body);
    }

    /**
     * 1차 스캔 — {@code <node>}의 {@code id}/{@code center}, {@code <link>}의
     * {@code id}/{@code from_node}/{@code to_node} 속성만 뽑는다(태그 여는 부분만 읽고
     * 본문은 스킵 — lanes/cells 등은 필요 없음).
     */
    private static Geometry scanGeometry(InputStream in) throws IOException {
        Map<Long, double[]> nodeCoords = new HashMap<>();
        Map<Long, long[]> linkEndpoints = new HashMap<>();
        Double[] base = new Double[2]; // [baseLat, baseLon]

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(in, StandardCharsets.UTF_8), 1 << 20)) {
            StringBuilder tag = null;
            int c;
            while ((c = reader.read()) >= 0) {
                char ch = (char) c;
                if (tag == null) {
                    if (ch == '<') tag = new StringBuilder("<");
                    continue;
                }
                tag.append(ch);
                if (ch != '>') continue;
                String t = tag.toString();
                tag = null;

                if (t.startsWith("<Network ")) {
                    Map<String, String> attrs = parseAttrs(t);
                    try {
                        if (attrs.get("base_lat") != null) base[0] = Double.parseDouble(attrs.get("base_lat"));
                        if (attrs.get("base_lon") != null) base[1] = Double.parseDouble(attrs.get("base_lon"));
                    } catch (NumberFormatException ignored) { }
                } else if (t.startsWith("<node ")) {
                    Map<String, String> attrs = parseAttrs(t);
                    putNodeCoords(nodeCoords, attrs);
                    if (!t.endsWith("/>")) readUntilClose(reader, "</node>");
                } else if (t.startsWith("<link ")) {
                    Map<String, String> attrs = parseAttrs(t);
                    putLinkEndpoints(linkEndpoints, attrs);
                    if (!t.endsWith("/>")) readUntilClose(reader, "</link>");
                }
            }
        }
        return new Geometry(nodeCoords, linkEndpoints, base[0], base[1]);
    }

    private static final Pattern ATTR_PATTERN = Pattern.compile("(\\w+)=\"([^\"]*)\"");

    private static Map<String, String> parseAttrs(String openTag) {
        Map<String, String> m = new HashMap<>();
        Matcher mm = ATTR_PATTERN.matcher(openTag);
        while (mm.find()) m.put(mm.group(1), mm.group(2));
        return m;
    }

    private static void putNodeCoords(Map<Long, double[]> nodeCoords, Map<String, String> attrs) {
        String idStr = attrs.get("id");
        String centerStr = attrs.get("center");
        if (idStr == null || centerStr == null) return;
        double[] xy = parseCenter(centerStr);
        if (xy != null) {
            try {
                nodeCoords.put(Long.parseLong(idStr), xy);
            } catch (NumberFormatException ignore) { /* 손상된 id — 좌표 스킵 */ }
        }
    }

    private static void putLinkEndpoints(Map<Long, long[]> linkEndpoints, Map<String, String> attrs) {
        String idStr = attrs.get("id");
        String fromStr = attrs.get("from_node");
        String toStr = attrs.get("to_node");
        if (idStr == null || fromStr == null || toStr == null) return;
        try {
            linkEndpoints.put(Long.parseLong(idStr), new long[]{Long.parseLong(fromStr), Long.parseLong(toStr)});
        } catch (NumberFormatException ignore) { /* 손상된 id — 스킵 */ }
    }

    private static double[] parseCenter(String s) {
        String[] parts = s.trim().split("\\s+");
        if (parts.length < 2) return null;
        try {
            return new double[]{Double.parseDouble(parts[0]), Double.parseDouble(parts[1])};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 방위각 계산에 필요한 좌표 정보. {@code nodeCoords}는 노드 id → (x, y)(로컬 좌표,
     * 진짜 컴퍼스 방위일 필요 없이 접근로끼리 상대 비교만 되면 충분), {@code linkEndpoints}
     * 는 링크 id → [from_node, to_node].
     */
    private static final class Geometry {
        // KtdbStreamingConverter/KtdbNetworkConverter와 동일한 로컬↔WGS84 변환 스케일 —
        // OSM 신호등(WGS84)과 노드 로컬 좌표를 비교하려면 이 상수로 되돌려야 한다.
        private static final double SCALE_X = 88000.0;
        private static final double SCALE_Y = 111000.0;

        final Map<Long, double[]> nodeCoords;
        final Map<Long, long[]> linkEndpoints;
        final Double baseLat;
        final Double baseLon;

        Geometry(Map<Long, double[]> nodeCoords, Map<Long, long[]> linkEndpoints, Double baseLat, Double baseLon) {
            this.nodeCoords = nodeCoords;
            this.linkEndpoints = linkEndpoints;
            this.baseLat = baseLat;
            this.baseLon = baseLon;
        }

        static Geometry fromNetwork(NetworkXml network) {
            Map<Long, double[]> nodeCoords = new HashMap<>();
            if (network.getNodes() != null) {
                for (NodeXml n : network.getNodes()) {
                    if (n.getId() == null || n.getCenter() == null) continue;
                    double[] xy = parseCenter(n.getCenter());
                    if (xy != null) nodeCoords.put(n.getId(), xy);
                }
            }
            Map<Long, long[]> linkEndpoints = new HashMap<>();
            if (network.getLinks() != null) {
                for (LinkXml l : network.getLinks()) {
                    if (l.getId() == null || l.getFromNode() == null || l.getToNode() == null) continue;
                    linkEndpoints.put(l.getId(), new long[]{l.getFromNode(), l.getToNode()});
                }
            }
            return new Geometry(nodeCoords, linkEndpoints, network.getBaseLat(), network.getBaseLon());
        }

        /** 노드의 로컬 좌표를 WGS84(lat, lon)로 역변환. base_lat/base_lon이나 노드 좌표가
         *  없으면 null — 호출부가 "확인 불가"로 안전 처리(OSM 게이트를 건너뛰고 기존 동작 유지). */
        double[] nodeWgs84(long nodeId) {
            if (baseLat == null || baseLon == null) return null;
            double[] xy = nodeCoords.get(nodeId);
            if (xy == null) return null;
            return new double[]{ xy[1] / SCALE_Y + baseLat, xy[0] / SCALE_X + baseLon };
        }

        /**
         * approachLinkId가 intersectionNodeId로 들어오는 방위각(도, 0~360). 좌표를
         * 못 찾으면(스트리밍 경로에서 상류 노드가 이번 스캔 범위 밖이거나, center/좌표
         * 데이터 자체가 없는 경우 등) null — 호출부가 안전하게 단독 페이즈로 폴백한다.
         */
        Double approachBearingDeg(long approachLinkId, long intersectionNodeId) {
            long[] endpoints = linkEndpoints.get(approachLinkId);
            if (endpoints == null) return null;
            long upstreamNodeId = endpoints[1] == intersectionNodeId ? endpoints[0] : endpoints[1];
            double[] upstream = nodeCoords.get(upstreamNodeId);
            double[] here = nodeCoords.get(intersectionNodeId);
            if (upstream == null || here == null) return null;
            double dx = here[0] - upstream[0];
            double dy = here[1] - upstream[1];
            if (dx == 0 && dy == 0) return null;
            double deg = Math.toDegrees(Math.atan2(dy, dx));
            return deg < 0 ? deg + 360 : deg;
        }
    }

    /** OSM 신호등 데이터가 임포트돼 있으면 매처를 만들고, 없으면 null(호출부가 게이트를
     *  건너뛰고 기존 동작 유지 — OsmPtFacilityRepository/OsmTurnRestrictionRepository와 동일 관례). */
    private OsmTrafficSignalMatcher buildOsmMatcher() {
        return osmTrafficSignalRepository.hasData()
                ? new OsmTrafficSignalMatcher(osmTrafficSignalRepository.loadAll())
                : null;
    }

    private static String wrapSignalXml(CharSequence body) {
        return "<?xml version='1.0' encoding='UTF-8'?>\n" +
                "<!-- 네트워크 가져오기 시 자동 생성된 샘플 신호입니다. 신호 메뉴에서 수정하세요. -->\n" +
                "<Signal id=\"0\">\n" + body + "</Signal>\n";
    }

    /** 노드 하나의 {@code <node>...</node>} 신호 블록, 신호가 불필요하면 null. */
    private static String buildNodeSignalBlockOrNull(NodeXml node, Geometry geo, OsmTrafficSignalMatcher osmMatcher) {
        if (node.getConnections() == null || node.getConnections().isEmpty()) return null;

        Map<Long, List<ConnectionXml>> approachMap = new LinkedHashMap<>();
        for (ConnectionXml conn : node.getConnections()) {
            if (conn.getFromLink() == null || conn.getToLink() == null) continue;
            approachMap.computeIfAbsent(conn.getFromLink(), k -> new ArrayList<>()).add(conn);
        }
        if (approachMap.size() <= 1) return null;

        // OSM 신호등 게이트: 접근로가 2개 이상이라도(=분기가 있는 실제 교차로) 실측(부천
        // 참조데이터, 커넥션노드 104개 중 신호 18개)상 대부분은 무신호 우선순위 교차로다.
        // OSM에 실제 traffic_signals가 확인된 위치 근처(40m)에서만 신호를 생성한다.
        // 노드 좌표를 WGS84로 못 되돌리면(base_lat/lon 누락 등) 판정 불가 — 과다생성보다
        // 과소생성(실제 신호 누락)이 시뮬레이션에 더 나쁠 수 있어 이 경우는 기존 동작 유지.
        if (osmMatcher != null && node.getId() != null) {
            double[] wgs = geo.nodeWgs84(node.getId());
            if (wgs != null && !osmMatcher.hasSignalNear(wgs[0], wgs[1])) return null;
        }

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
        if (approachToTurnId.isEmpty()) return null; // 전부 RTOR → 신호 불필요

        List<List<String>> phaseGroups = groupApproachesByOppositeBearing(approachToTurnId, geo, node.getId());

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
        for (String tid : approachToTurnId.values()) {
            String xmlId = String.valueOf(xmlTurnSeq++);
            turnKeyToXmlId.put(tid, xmlId);
            turnsXml.append("      <turn id=\"").append(xmlId)
                    .append("\" turning=\"S\" type=\"None\" connList=\"")
                    .append(String.join(" ", turnConnIds.get(tid))).append("\"/>\n");
        }

        // 평시(0)/혼잡(1) 두 플랜 — 페이즈 그룹 구성(어느 접근로끼리 묶이는지)은 시간대와
        // 무관하게 동일하고, 페이즈당 녹색 시간만 다르다(혼잡시간대는 더 길게 줘서 처리용량 확보).
        StringBuilder plansXml = new StringBuilder();
        plansXml.append(buildPlanXml(0, GREEN_OFFPEAK, phaseGroups, turnKeyToXmlId, rtorXmlIds, node.getId()));
        plansXml.append(buildPlanXml(1, GREEN_PEAK, phaseGroups, turnKeyToXmlId, rtorXmlIds, node.getId()));

        return "  <node id=\"" + node.getId() + "\">\n"
                + "    <turnList>\n" + turnsXml + "    </turnList>\n"
                + "    <planList>\n" + plansXml + "    </planList>\n"
                + "  </node>\n";
    }

    /**
     * 접근로를 "마주보는 방향(방위각差가 180±{@link #OPPOSITE_BEARING_TOLERANCE_DEG}
     * 이내)" 쌍으로 묶어 동시 녹색 그룹을 만든다(실제 2페이즈 신호와 동일 원리 — 반대편
     * 직진/좌회전끼리 동시 운영, 좌회전은 허용 좌회전이라 반대편 직진에 양보하며 진행하는
     * 실제 관행과 동일). 방위각을 계산 못 하거나(좌표 데이터 없음) 마주보는 짝을 못 찾은
     * 접근로는 안전하게 단독 그룹(페이즈)으로 남긴다 — 잘못 페어링해 직교하는 접근로가
     * 동시 녹색이 되는 것보다, 페어링을 포기하고 혼자 도는 게 항상 안전하다.
     */
    private static List<List<String>> groupApproachesByOppositeBearing(
            Map<Long, String> approachToTurnId, Geometry geo, long nodeId) {

        List<Long> approaches = new ArrayList<>(approachToTurnId.keySet());
        Map<Long, Double> bearings = new LinkedHashMap<>();
        for (Long fromLink : approaches) {
            Double b = geo.approachBearingDeg(fromLink, nodeId);
            if (b != null) bearings.put(fromLink, b);
        }

        List<List<String>> groups = new ArrayList<>();
        Set<Long> paired = new HashSet<>();
        for (Long a : approaches) {
            if (paired.contains(a)) continue;
            Double ba = bearings.get(a);
            Long bestPartner = null;
            double bestDistFrom180 = Double.MAX_VALUE;
            if (ba != null) {
                for (Long b : approaches) {
                    if (b.equals(a) || paired.contains(b)) continue;
                    Double bb = bearings.get(b);
                    if (bb == null) continue;
                    double distFrom180 = Math.abs(angularDiffDeg(ba, bb) - 180);
                    if (distFrom180 <= OPPOSITE_BEARING_TOLERANCE_DEG && distFrom180 < bestDistFrom180) {
                        bestDistFrom180 = distFrom180;
                        bestPartner = b;
                    }
                }
            }
            paired.add(a);
            if (bestPartner != null) {
                paired.add(bestPartner);
                groups.add(new ArrayList<>(List.of(approachToTurnId.get(a), approachToTurnId.get(bestPartner))));
            } else {
                groups.add(new ArrayList<>(List.of(approachToTurnId.get(a))));
            }
        }
        return groups;
    }

    /** 두 방위각(도, 0~360) 사이의 최단 각도差(0~180). */
    private static double angularDiffDeg(double a, double b) {
        double diff = Math.abs(a - b) % 360;
        return diff > 180 ? 360 - diff : diff;
    }

    /**
     * 페이즈 그룹(마주보는 접근로 쌍 또는 단독 접근로)을 순서대로 순환하는 플랜을 만든다.
     * 같은 그룹 내 접근로끼리만 동시 녹색이므로, 그룹 자체가 안전(마주봄) 또는 단독(자명히
     * 안전)일 때만 이 메서드가 호출된다는 전제가 안전성의 근거다.
     */
    private static String buildPlanXml(int planId, int greenPerPhase, List<List<String>> phaseGroups,
                                        Map<String, String> turnKeyToXmlId, List<String> rtorXmlIds, long nodeId) {
        int n = phaseGroups.size();
        int cycle = n * (greenPerPhase + YELLOW);
        int offset = (int) (nodeId % Math.max(cycle, 1));

        StringBuilder phasesXml = new StringBuilder();
        int phaseId = 0;
        for (List<String> group : phaseGroups) {
            phasesXml.append(phaseXml(phaseId++, greenPerPhase, group, turnKeyToXmlId, rtorXmlIds, true, greenPerPhase));
            phasesXml.append(phaseXml(phaseId++, YELLOW, group, turnKeyToXmlId, rtorXmlIds, false, greenPerPhase));
        }
        return "      <plan id=\"" + planId + "\" cycle=\"" + cycle + "\" offset=\"" + offset + "\">\n"
                + phasesXml
                + "      </plan>\n";
    }

    private static String phaseXml(int phaseId, int duration, List<String> activeTurnKeys,
                                    Map<String, String> turnKeyToXmlId, List<String> rtorXmlIds,
                                    boolean isGreen, int maxGreenTime) {
        List<String> xmlIds = new ArrayList<>(rtorXmlIds); // RTOR는 모든 페이즈에서 상시 허용
        for (String key : activeTurnKeys) xmlIds.add(turnKeyToXmlId.get(key));
        String turnListAttr = String.join(" ", xmlIds);
        StringBuilder sb = new StringBuilder()
                .append("      <phase id=\"").append(phaseId).append("\" duration=\"").append(duration)
                .append("\" turnList=\"").append(turnListAttr).append("\"");
        if (isGreen) {
            sb.append(" minGreenTime=\"").append(MIN_GREEN).append("\" maxGreenTime=\"").append(maxGreenTime).append("\"");
        }
        return sb.append("/>\n").toString();
    }

    // ── 스트리밍 블록 스캔 유틸 (NetworkStreamingDiffService와 동일 기법) ──────────

    /** '<node ...>' 이후부터 종료 태그까지 읽어 붙인다(종료 태그 포함). */
    private static String readUntilClose(BufferedReader reader, String closeTag) throws IOException {
        StringBuilder sb = new StringBuilder(2048);
        int matched = 0;
        int c;
        while ((c = reader.read()) >= 0) {
            char ch = (char) c;
            sb.append(ch);
            matched = (ch == closeTag.charAt(matched)) ? matched + 1
                    : (ch == closeTag.charAt(0) ? 1 : 0);
            if (matched == closeTag.length()) return sb.toString();
        }
        throw new IOException("network.xml 스트림이 " + closeTag + " 없이 끝났습니다 (손상된 파일?)");
    }

    private static NodeXml unmarshalNodeFragment(JAXBContext jaxb, String block) throws Exception {
        Unmarshaller u = jaxb.createUnmarshaller();
        XMLInputFactory f = XMLInputFactory.newFactory();
        f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        XMLStreamReader sr = f.createXMLStreamReader(new StringReader(block));
        try {
            return u.unmarshal(sr, NodeXml.class).getValue();
        } finally {
            sr.close();
        }
    }
}
