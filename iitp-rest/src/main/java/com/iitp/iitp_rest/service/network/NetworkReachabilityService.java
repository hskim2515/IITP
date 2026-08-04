package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 네트워크의 <b>실제 회전 허용(커넥션) 그래프</b> 기준 도달 가능성 계산.
 *
 * <p>초기 구현은 링크의 from_node/to_node 만으로 "노드 그래프"를 만들어 도달 가능성을
 * 판정했는데, 이건 <b>불충분함이 gdb로 실측 확인됐다</b> — 실측(scenario1_2 대전 오정동
 * 재임포트, 11000357): 링크 인접 그래프상으로는 도달 가능(BFS 통과)한데도, 경로상의
 * 어떤 교차로에 그 회전을 허용하는 {@code <connection>}이 없어(실제 통행 불가) route-generator
 * 가 경로를 못 찾고 Route.json 을 빈 채로 두며, nextsim 이 그 수요의 캐시된 경로를
 * 조회하려다 std::out_of_range 로 크래시한다. 도로망은 교차로마다 <b>허용된 회전만</b>
 * {@code <connection>}으로 명시하므로, 진짜 도달 가능성은 "링크→링크(커넥션 경유)" 그래프로
 * 계산해야 한다.
 *
 * <p>NextSim의 기존 "고립 컴포넌트" 격리 로직({@code NextSimRunner.computeMainComponentNodeIds})은
 * 이보다도 더 느슨하게(링크를 무방향으로) 취급해 "같은 덩어리에 속하는지"만 본다.
 */
@Service
public class NetworkReachabilityService {

    /** 커넥션 기반 링크→링크 그래프 (from_link → [to_link, ...]) */
    public Map<String, List<String>> buildLinkConnectionGraph(NetworkXml network) {
        Map<String, List<String>> adj = new HashMap<>();
        if (network == null || network.getNodes() == null) return adj;
        for (NodeXml node : network.getNodes()) {
            if (node.getConnections() == null) continue;
            for (ConnectionXml c : node.getConnections()) {
                if (c.getFromLink() == null || c.getToLink() == null) continue;
                adj.computeIfAbsent(String.valueOf(c.getFromLink()), k -> new java.util.ArrayList<>())
                        .add(String.valueOf(c.getToLink()));
            }
        }
        return adj;
    }

    /** 노드 id → 그 노드에서 나가는(from_node) 링크 id 목록 */
    public Map<String, List<String>> buildNodeOutLinks(NetworkXml network) {
        Map<String, List<String>> out = new HashMap<>();
        if (network == null || network.getLinks() == null) return out;
        for (LinkXml link : network.getLinks()) {
            if (link.getFromNode() == null || link.getId() == null) continue;
            out.computeIfAbsent(String.valueOf(link.getFromNode()), k -> new java.util.ArrayList<>())
                    .add(String.valueOf(link.getId()));
        }
        return out;
    }

    /** 노드 id → 그 노드로 들어오는(to_node) 링크 id 목록 */
    public Map<String, List<String>> buildNodeInLinks(NetworkXml network) {
        Map<String, List<String>> in = new HashMap<>();
        if (network == null || network.getLinks() == null) return in;
        for (LinkXml link : network.getLinks()) {
            if (link.getToNode() == null || link.getId() == null) continue;
            in.computeIfAbsent(String.valueOf(link.getToNode()), k -> new java.util.ArrayList<>())
                    .add(String.valueOf(link.getId()));
        }
        return in;
    }

    /** startLinks 에서 커넥션을 따라 도달 가능한 링크 id 집합(시작 링크 포함) */
    public Set<String> reachableLinksFrom(Map<String, List<String>> linkGraph, Iterable<String> startLinks) {
        Set<String> visited = new HashSet<>();
        Deque<String> stack = new ArrayDeque<>();
        for (String s : startLinks) {
            if (visited.add(s)) stack.push(s);
        }
        while (!stack.isEmpty()) {
            String cur = stack.pop();
            for (String next : linkGraph.getOrDefault(cur, List.of())) {
                if (visited.add(next)) stack.push(next);
            }
        }
        return visited;
    }

    /** sourceNode 의 out-link 들에서 커넥션을 따라 도달 가능한 링크 집합에 sinkNode 의 in-link 중 하나라도 있는지 */
    public boolean isNodeReachable(Map<String, List<String>> linkGraph,
                                    Map<String, List<String>> nodeOutLinks,
                                    Map<String, List<String>> nodeInLinks,
                                    String sourceNode, String sinkNode) {
        if (sourceNode == null || sinkNode == null) return false;
        if (sourceNode.equals(sinkNode)) return true;
        List<String> startLinks = nodeOutLinks.getOrDefault(sourceNode, List.of());
        if (startLinks.isEmpty()) return false;
        Set<String> reached = reachableLinksFrom(linkGraph, startLinks);
        for (String inLink : nodeInLinks.getOrDefault(sinkNode, List.of())) {
            if (reached.contains(inLink)) return true;
        }
        return false;
    }

    /** 노드 id(문자열) → type="terminal" 여부 */
    private Map<String, Boolean> buildTerminalFlags(NetworkXml network) {
        Map<String, Boolean> isTerminal = new HashMap<>();
        if (network != null && network.getNodes() != null) {
            for (NodeXml n : network.getNodes()) {
                if (n.getId() == null) continue;
                isTerminal.put(String.valueOf(n.getId()), n.getType() == NodeType.Terminal);
            }
        }
        return isTerminal;
    }

    /**
     * OD 매트릭스에서 아래 두 조건 중 하나라도 해당하는 수요를 제거한다(in-place).
     * OD 생성/편집 시점의 1차 방어 — NextSimRunner 스테이징 시점의 재검증과 짝을 이룬다.
     * <ol>
     *   <li>커넥션(실제 허용 회전) 기준 source→sink 경로 없음 — 링크 인접만으론 부족(위 클래스
     *       설명 참조), 교차로마다 실제로 그 회전을 허용하는 connection 이 있어야 진짜 도달 가능</li>
     *   <li>source 또는 sink 가 type="terminal" 이 아님(실측: 고립된 섬 안의 두 노드끼리는
     *       서로 도달 가능해도, 둘 다 메인 컴포넌트 밖이라 nextsim 실행 시 garage 로 전환되며
     *       같은 크래시로 이어짐)</li>
     * </ol>
     *
     * @return 제거된 수요 건수
     */
    public int filterUnreachableDemands(OdMatrixXml od, NetworkXml network) {
        if (od == null || od.getOdMatrices() == null) return 0;
        Map<String, List<String>> linkGraph = buildLinkConnectionGraph(network);
        Map<String, List<String>> nodeOutLinks = buildNodeOutLinks(network);
        Map<String, List<String>> nodeInLinks = buildNodeInLinks(network);
        Map<String, Boolean> isTerminal = buildTerminalFlags(network);
        Map<String, Set<String>> reachedCache = new HashMap<>();
        int removed = 0;
        for (OdMatrixXml.OdMatrixItemXml item : od.getOdMatrices()) {
            removed += filterDemandList(item.getAvodMatrix() == null ? null : item.getAvodMatrix().getDemands(),
                    linkGraph, nodeOutLinks, nodeInLinks, isTerminal, reachedCache);
            removed += filterDemandList(item.getNvodMatrix() == null ? null : item.getNvodMatrix().getDemands(),
                    linkGraph, nodeOutLinks, nodeInLinks, isTerminal, reachedCache);
        }
        return removed;
    }

    private int filterDemandList(List<OdMatrixXml.DemandXml> demands,
                                 Map<String, List<String>> linkGraph,
                                 Map<String, List<String>> nodeOutLinks,
                                 Map<String, List<String>> nodeInLinks,
                                 Map<String, Boolean> isTerminal,
                                 Map<String, Set<String>> reachedCache) {
        if (demands == null) return 0;
        int removed = 0;
        var it = demands.iterator();
        while (it.hasNext()) {
            OdMatrixXml.DemandXml d = it.next();
            String src = d.getSource(), snk = d.getSink();
            boolean bothTerminal = src != null && snk != null
                    && Boolean.TRUE.equals(isTerminal.get(src)) && Boolean.TRUE.equals(isTerminal.get(snk));
            boolean reachable = bothTerminal && isReachableCached(linkGraph, nodeOutLinks, nodeInLinks,
                    reachedCache, src, snk);
            if (!reachable) {
                it.remove();
                removed++;
            }
        }
        return removed;
    }

    private boolean isReachableCached(Map<String, List<String>> linkGraph,
                                       Map<String, List<String>> nodeOutLinks,
                                       Map<String, List<String>> nodeInLinks,
                                       Map<String, Set<String>> reachedCache,
                                       String source, String sink) {
        Set<String> reached = reachedCache.computeIfAbsent(source,
                s -> reachableLinksFrom(linkGraph, nodeOutLinks.getOrDefault(s, List.of())));
        for (String inLink : nodeInLinks.getOrDefault(sink, List.of())) {
            if (reached.contains(inLink)) return true;
        }
        return false;
    }

    /**
     * {@link #filterUnreachableDemands(OdMatrixXml, NetworkXml)} 와 판정 로직은 동일하지만,
     * 대규모 네트워크(전국 규모, 스트리밍 diff 저장 경로)용 — network.xml 을 {@code NetworkXml}
     * 객체로 통째 역직렬화하면 힙을 초과하므로(수도권 364MB 실측), 정규식으로 스트림 스캔해
     * 같은 커넥션 그래프(링크→링크, 노드별 in/out 링크, 터미널 여부)를 구성한다.
     * {@code NextSimRunner.filterUnreachableDemands} 의 스트리밍 파서와 동일 기법.
     *
     * @return 제거된 수요 건수
     */
    public int filterUnreachableDemands(OdMatrixXml od, java.nio.file.Path networkXmlPath) throws java.io.IOException {
        if (od == null || od.getOdMatrices() == null) return 0;
        Map<String, List<String>> nodeOutLinks = new HashMap<>();
        Map<String, List<String>> nodeInLinks = new HashMap<>();
        Map<String, List<String>> linkGraph = new HashMap<>();
        Map<String, Boolean> isTerminal = new HashMap<>();
        java.util.regex.Pattern linkPat = java.util.regex.Pattern.compile(
                "<link id=\"([^\"]+)\" from_node=\"([^\"]+)\" to_node=\"([^\"]+)\"");
        java.util.regex.Pattern nodePat = java.util.regex.Pattern.compile("<node id=\"([^\"]+)\" type=\"([^\"]+)\"");
        java.util.regex.Pattern connPat = java.util.regex.Pattern.compile(
                "<connection\\s[^>]*from_link=\"(\\d+)\"[^>]*to_link=\"(\\d+)\"");
        try (var reader = java.nio.file.Files.newBufferedReader(networkXmlPath, java.nio.charset.StandardCharsets.UTF_8)) {
            char[] buf = new char[1 << 22];
            String carry = "";
            int n;
            while ((n = reader.read(buf)) > 0) {
                String chunk = carry + new String(buf, 0, n);
                var lm = linkPat.matcher(chunk);
                while (lm.find()) {
                    String lid = lm.group(1), f = lm.group(2), t = lm.group(3);
                    nodeOutLinks.computeIfAbsent(f, k -> new java.util.ArrayList<>()).add(lid);
                    nodeInLinks.computeIfAbsent(t, k -> new java.util.ArrayList<>()).add(lid);
                }
                var nm = nodePat.matcher(chunk);
                while (nm.find()) {
                    isTerminal.put(nm.group(1), "terminal".equals(nm.group(2)));
                }
                var cm = connPat.matcher(chunk);
                while (cm.find()) {
                    linkGraph.computeIfAbsent(cm.group(1), k -> new java.util.ArrayList<>()).add(cm.group(2));
                }
                carry = chunk.length() > 512 ? chunk.substring(chunk.length() - 512) : chunk;
            }
        }

        Map<String, Set<String>> reachedCache = new HashMap<>();
        int removed = 0;
        for (OdMatrixXml.OdMatrixItemXml item : od.getOdMatrices()) {
            removed += filterDemandList(item.getAvodMatrix() == null ? null : item.getAvodMatrix().getDemands(),
                    linkGraph, nodeOutLinks, nodeInLinks, isTerminal, reachedCache);
            removed += filterDemandList(item.getNvodMatrix() == null ? null : item.getNvodMatrix().getDemands(),
                    linkGraph, nodeOutLinks, nodeInLinks, isTerminal, reachedCache);
        }
        return removed;
    }
}
