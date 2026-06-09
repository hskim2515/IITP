package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.ktdb.KtdbLink;
import com.iitp.iitp_rest.model.ktdb.KtdbNode;
import com.iitp.iitp_rest.repository.KtdbLinkRepository;
import com.iitp.iitp_rest.repository.KtdbNodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

/**
 * KTDB 표준노드링크 DB → OSM XML bytes 변환.
 * netconvert에 직접 전달하여 교차로 클러스터링/connection 처리.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KtdbOsmService {

    private static final Map<Integer, String> ROAD_RANK_TO_HIGHWAY = Map.of(
            102, "motorway",
            103, "trunk",
            104, "primary",
            105, "secondary",
            106, "tertiary",
            107, "unclassified",
            108, "residential"
    );

    private final KtdbLinkRepository linkRepo;
    private final KtdbNodeRepository nodeRepo;

    /**
     * bbox 내 KTDB 링크/노드를 OSM XML로 변환하여 반환.
     * @throws IllegalArgumentException 해당 bbox에 데이터가 없을 때
     */
    public byte[] generateOsmXml(double south, double west, double north, double east) {
        List<KtdbLink> links = linkRepo.findByBbox(west, east, south, north);
        if (links.isEmpty()) {
            throw new IllegalArgumentException("해당 bbox에 KTDB 데이터가 없습니다. DB import 여부를 확인하세요.");
        }

        // 사용된 노드 ID 수집 → 일괄 조회
        Set<String> nodeIds = new HashSet<>();
        for (KtdbLink lk : links) {
            nodeIds.add(lk.getFNode());
            nodeIds.add(lk.getTNode());
        }
        Map<String, KtdbNode> nodeMap = nodeRepo.findByNodeIdIn(nodeIds)
                .stream().collect(Collectors.toMap(KtdbNode::getNodeId, n -> n));

        long skipped = links.stream()
                .filter(lk -> !nodeMap.containsKey(lk.getFNode()) || !nodeMap.containsKey(lk.getTNode()))
                .count();
        log.info("KTDB→OSM 변환: 링크 {}개, 노드 {}개, 노드 누락으로 스킵 {}개",
                links.size(), nodeMap.size(), skipped);

        // OSM XML 규칙: <node> 전부 → <way> 전부 → <relation> 순서
        // synthetic 중간점 노드를 way 사이에 끼우면 netconvert가 파싱 실패

        record SyntheticNode(long id, double lat, double lng) {}
        record LinkEntry(KtdbLink link, List<Long> midIds) {}

        // ── 1pass: synthetic 노드 ID 미리 수집 ───────────────────────────────
        long syntheticId = 1_000_000_000L; // KTDB ID(~10자리) 보다 큰 양수
        List<SyntheticNode> synNodes  = new ArrayList<>();
        List<LinkEntry>     linkEntries = new ArrayList<>();

        for (KtdbLink lk : links) {
            if (!nodeMap.containsKey(lk.getFNode()) || !nodeMap.containsKey(lk.getTNode())) continue;
            List<Map<String, Double>> coords = lk.getCoords();
            List<Long> midIds = new ArrayList<>();
            if (coords != null && coords.size() > 2) {
                for (int i = 1; i < coords.size() - 1; i++) {
                    Map<String, Double> pt = coords.get(i);
                    synNodes.add(new SyntheticNode(syntheticId, pt.get("lat"), pt.get("lng")));
                    midIds.add(syntheticId++);
                }
            }
            linkEntries.add(new LinkEntry(lk, midIds));
        }

        // ── 2pass: XML 생성 (nodes → ways) ──────────────────────────────────
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<osm version=\"0.6\">\n");

        // 1. 실제 KTDB 노드
        for (KtdbNode node : nodeMap.values()) {
            sb.append(String.format("  <node id=\"%s\" lat=\"%.7f\" lon=\"%.7f\"/>\n",
                    node.getNodeId(), node.getLat(), node.getLon()));
        }
        // 2. synthetic 중간점 노드 (반드시 way보다 먼저)
        for (SyntheticNode sn : synNodes) {
            sb.append(String.format("  <node id=\"%d\" lat=\"%.7f\" lon=\"%.7f\"/>\n",
                    sn.id(), sn.lat(), sn.lng()));
        }
        // 3. way
        for (LinkEntry entry : linkEntries) {
            KtdbLink lk = entry.link();
            String highway = ROAD_RANK_TO_HIGHWAY.getOrDefault(lk.getRoadRank(), "tertiary");
            sb.append(String.format("  <way id=\"%s\">\n", lk.getLinkId()));
            sb.append(String.format("    <nd ref=\"%s\"/>\n", lk.getFNode()));
            for (long mid : entry.midIds()) sb.append(String.format("    <nd ref=\"%d\"/>\n", mid));
            sb.append(String.format("    <nd ref=\"%s\"/>\n", lk.getTNode()));
            sb.append(String.format("    <tag k=\"highway\" v=\"%s\"/>\n", highway));
            sb.append(String.format("    <tag k=\"lanes\" v=\"%d\"/>\n", lk.getLanes()));
            sb.append(String.format("    <tag k=\"maxspeed\" v=\"%d\"/>\n", lk.getMaxSpd()));
            sb.append(             "    <tag k=\"oneway\" v=\"yes\"/>\n");
            if (lk.getRoadName() != null && !lk.getRoadName().isBlank())
                sb.append(String.format("    <tag k=\"name\" v=\"%s\"/>\n", escapeXml(lk.getRoadName())));
            sb.append("  </way>\n");
        }

        sb.append("</osm>\n");
        byte[] result = sb.toString().getBytes(StandardCharsets.UTF_8);

        // DEBUG: OSM XML 파일 저장 (확인 후 제거)
        try {
            java.nio.file.Files.writeString(java.nio.file.Path.of("/tmp/ktdb_last.osm"), sb.toString());
            log.info("[DEBUG] OSM XML 저장: /tmp/ktdb_last.osm ({} bytes)", result.length);
        } catch (Exception e) { /* ignore */ }

        return result;
    }

    private static String escapeXml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }
}
