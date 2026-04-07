package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.port.PortType;
import com.iitp.iitp_rest.model.network.port.PortXml;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * NetworkXml 구조적 정합성 검증
 *
 * 오류(errors)   : 치명적 — SFTP 저장 차단
 * 경고(warnings) : 보정 권장 — 저장은 허용
 *
 * 검증 항목:
 *   1. 최소 크기 (노드 ≥ 2, 링크 ≥ 1)
 *   2. 링크 from_node / to_node 참조 무결성
 *   3. 노드 포트 ↔ 링크 참조 일관성 (포트가 가리키는 link_id 존재 여부 + 방향 일치)
 *   4. 노드 선언 num_port / num_connection ↔ 실제 자식 수 일치
 *   5. 커넥션 from_link / to_link ↔ 노드 포트 등록 여부
 *   6. 커넥션 from_lane / to_lane ↔ 링크 num_lane 범위
 *   7. 링크 선언 num_lane ↔ 실제 lane 자식 수 일치
 *   8. 레인 선언 num_cell ↔ 실제 cell 자식 수 일치
 *   9. 링크 길이 ≤ 0
 *  10. 고립 연결 성분
 */
@Slf4j
@Service
public class OsmNetworkValidator {

    public record Result(
            boolean valid,
            List<String> errors,
            List<String> warnings,
            int nodeCount,
            int linkCount
    ) {}

    public Result validate(NetworkXml networkXml) {
        List<String> errors   = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        List<NodeXml> nodes = networkXml.getNodes() != null ? networkXml.getNodes() : List.of();
        List<LinkXml> links = networkXml.getLinks() != null ? networkXml.getLinks() : List.of();

        // ── 1. 최소 크기 ──────────────────────────────────────────────────────
        if (nodes.size() < 2) errors.add("노드 수 부족: " + nodes.size() + "개 (최소 2개 필요)");
        if (links.isEmpty())  errors.add("링크가 없습니다.");

        if (!errors.isEmpty()) {
            return new Result(false, errors, warnings, nodes.size(), links.size());
        }

        Set<Long> nodeIds = nodes.stream().map(NodeXml::getId).collect(Collectors.toSet());
        Map<Long, LinkXml> linkMap = links.stream()
                .collect(Collectors.toMap(LinkXml::getId, l -> l, (a, b) -> a));

        // ── 2. 링크 from_node / to_node 참조 무결성 ──────────────────────────
        List<Long> badFrom = links.stream()
                .filter(l -> !nodeIds.contains(l.getFromNode())).map(LinkXml::getId).toList();
        List<Long> badTo = links.stream()
                .filter(l -> !nodeIds.contains(l.getToNode())).map(LinkXml::getId).toList();
        if (!badFrom.isEmpty())
            errors.add("from_node 미존재 링크 " + badFrom.size() + "개: " + summarize(badFrom));
        if (!badTo.isEmpty())
            errors.add("to_node 미존재 링크 " + badTo.size() + "개: " + summarize(badTo));

        // 노드별 from_node / to_node 역인덱스
        Map<Long, Set<Long>> nodeFromLinks = new HashMap<>(); // nodeId → set of link IDs where fromNode==nodeId
        Map<Long, Set<Long>> nodeToLinks   = new HashMap<>(); // nodeId → set of link IDs where toNode==nodeId
        for (LinkXml l : links) {
            if (l.getFromNode() != null) nodeFromLinks.computeIfAbsent(l.getFromNode(), k -> new HashSet<>()).add(l.getId());
            if (l.getToNode()   != null) nodeToLinks  .computeIfAbsent(l.getToNode(),   k -> new HashSet<>()).add(l.getId());
        }

        int portLinkMissing   = 0; // 포트가 가리키는 link_id 없음
        int portDirMismatch   = 0; // 포트 in/out 방향이 링크 from/to와 불일치
        int numPortMismatch   = 0; // num_port 선언값 ≠ 실제 포트 수
        int numConnMismatch   = 0; // num_connection 선언값 ≠ 실제 커넥션 수
        int connLinkNotInPort = 0; // 커넥션 from/to link가 노드 포트에 없음
        int connLaneOverflow  = 0; // 커넥션 차선 번호 ≥ 링크 num_lane
        int laneCountMismatch = 0; // 링크 num_lane ≠ 실제 lane 자식 수
        int cellCountMismatch = 0; // lane num_cell ≠ 실제 cell 자식 수

        for (NodeXml node : nodes) {
            Long nid = node.getId();
            List<PortXml> ports = node.getPorts() != null ? node.getPorts() : List.of();
            List<ConnectionXml> conns = node.getConnections() != null ? node.getConnections() : List.of();

            // ── 3. 포트 ↔ 링크 참조 일관성 ───────────────────────────────────
            Set<Long> nodeInPortLinks  = new HashSet<>();
            Set<Long> nodeOutPortLinks = new HashSet<>();
            for (PortXml port : ports) {
                Long plid = parseLinkId(port.getLinkId());
                if (plid == null || !linkMap.containsKey(plid)) {
                    portLinkMissing++;
                    continue;
                }
                // 방향 검사: in 포트 → 해당 링크의 to_node가 이 노드여야 함
                //            out 포트 → 해당 링크의 from_node가 이 노드여야 함
                LinkXml pl = linkMap.get(plid);
                boolean isInPort = port.getType() == PortType.in;
                if (isInPort) {
                    nodeInPortLinks.add(plid);
                    if (!nid.equals(pl.getToNode())) portDirMismatch++;
                } else {
                    nodeOutPortLinks.add(plid);
                    if (!nid.equals(pl.getFromNode())) portDirMismatch++;
                }
            }

            // ── 4. num_port / num_connection 선언 ↔ 실제 자식 수 ─────────────
            if (node.getNumPort() != ports.size()) numPortMismatch++;
            if (node.getNumConnection() != conns.size()) numConnMismatch++;

            // ── 5. 커넥션 from_link / to_link ↔ 노드 포트 등록 여부 ──────────
            // ── 6. 커넥션 차선 번호 ↔ 링크 num_lane 범위 ─────────────────────
            Set<Long> allPortLinks = new HashSet<>();
            allPortLinks.addAll(nodeInPortLinks);
            allPortLinks.addAll(nodeOutPortLinks);

            for (ConnectionXml c : conns) {
                Long fl = c.getFromLink(), tl = c.getToLink();

                if (fl != null && !allPortLinks.contains(fl)) connLinkNotInPort++;
                if (tl != null && !allPortLinks.contains(tl)) connLinkNotInPort++;

                if (fl != null && linkMap.containsKey(fl) && c.getFromLane() != null) {
                    int maxLane = linkMap.get(fl).getNumLane();
                    if (c.getFromLane().intValue() >= maxLane) connLaneOverflow++;
                }
                if (tl != null && linkMap.containsKey(tl) && c.getToLane() != null) {
                    int maxLane = linkMap.get(tl).getNumLane();
                    if (c.getToLane().intValue() >= maxLane) connLaneOverflow++;
                }
            }
        }

        // ── 7. 링크 num_lane ↔ 실제 lane 자식 수 ────────────────────────────
        // ── 8. 레인 num_cell ↔ 실제 cell 자식 수 ─────────────────────────────
        // ── 9. 링크 길이 ≤ 0 ──────────────────────────────────────────────────
        int zeroLen = 0;
        for (LinkXml link : links) {
            List<LaneXml> lanes = link.getLanes() != null ? link.getLanes() : List.of();
            if (link.getNumLane() != lanes.size()) laneCountMismatch++;
            if (link.getLength() <= 0) zeroLen++;
            for (LaneXml lane : lanes) {
                int declaredCells = lane.getNumCell();
                int actualCells   = lane.getCells() != null ? lane.getCells().size() : 0;
                if (declaredCells != actualCells) cellCountMismatch++;
            }
        }

        // ── 결과 집계 ─────────────────────────────────────────────────────────
        // 치명적 오류
        if (portLinkMissing > 0)
            errors.add("포트가 참조하는 링크 ID 미존재: " + portLinkMissing + "건 — 링크 삭제 후 포트가 갱신되지 않은 노드가 있습니다.");
        if (connLinkNotInPort > 0)
            errors.add("커넥션의 from/to 링크가 해당 노드 포트에 미등록: " + connLinkNotInPort + "건 — 커넥션과 포트 간 불일치가 있습니다.");

        // 경고
        if (portDirMismatch > 0)
            warnings.add("포트 방향(in/out)과 링크 from_node/to_node 불일치: " + portDirMismatch + "건");
        if (numPortMismatch > 0)
            warnings.add("num_port 선언값 ≠ 실제 포트 수 불일치 노드: " + numPortMismatch + "개");
        if (numConnMismatch > 0)
            warnings.add("num_connection 선언값 ≠ 실제 커넥션 수 불일치 노드: " + numConnMismatch + "개");
        if (connLaneOverflow > 0)
            warnings.add("커넥션 차선 번호 ≥ 링크 num_lane 초과: " + connLaneOverflow + "건");
        if (laneCountMismatch > 0)
            warnings.add("num_lane 선언값 ≠ 실제 lane 자식 수 불일치 링크: " + laneCountMismatch + "개");
        if (cellCountMismatch > 0)
            warnings.add("num_cell 선언값 ≠ 실제 cell 자식 수 불일치 레인: " + cellCountMismatch + "개");
        if (zeroLen > 0)
            warnings.add("길이가 0 이하인 링크: " + zeroLen + "개");

        // ── 10. 고립 연결 성분 ────────────────────────────────────────────────
        int isolatedLinks = countIsolatedLinks(nodeIds, links);
        if (isolatedLinks > 0)
            warnings.add("주 네트워크와 연결되지 않은 고립 링크: " + isolatedLinks + "개");

        boolean valid = errors.isEmpty();
        log.info("네트워크 검증 결과: valid={}, errors={}, warnings={}", valid, errors.size(), warnings.size());
        return new Result(valid, errors, warnings, nodes.size(), links.size());
    }

    // ── 내부 헬퍼 ─────────────────────────────────────────────────────────────

    private int countIsolatedLinks(Set<Long> nodeIds, List<LinkXml> links) {
        Map<Long, Long> parent = new HashMap<>();
        for (Long nid : nodeIds) parent.put(nid, nid);
        for (LinkXml link : links) union(parent, link.getFromNode(), link.getToNode());

        Map<Long, Integer> compSize = new HashMap<>();
        for (Long nid : nodeIds) compSize.merge(find(parent, nid), 1, Integer::sum);
        Long largestRoot = compSize.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey).orElse(-1L);

        return (int) links.stream()
                .filter(l -> l.getFromNode() != null && !find(parent, l.getFromNode()).equals(largestRoot))
                .count();
    }

    private Long find(Map<Long, Long> parent, Long id) {
        if (!parent.containsKey(id)) return id;
        if (!parent.get(id).equals(id)) parent.put(id, find(parent, parent.get(id)));
        return parent.get(id);
    }

    private void union(Map<Long, Long> parent, Long a, Long b) {
        if (a == null || b == null) return;
        Long ra = find(parent, a), rb = find(parent, b);
        if (!ra.equals(rb)) parent.put(ra, rb);
    }

    /** PortXml.linkId 는 String 타입 — Long으로 파싱 */
    private Long parseLinkId(String s) {
        if (s == null || s.isBlank()) return null;
        try { return Long.parseLong(s.trim()); }
        catch (NumberFormatException e) { return null; }
    }

    private String summarize(List<Long> ids) {
        if (ids.size() <= 5) return ids.toString();
        return ids.subList(0, 5) + " ... 외 " + (ids.size() - 5) + "개";
    }
}
