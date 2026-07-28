package com.iitp.iitp_rest.service.network;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * osmium tags-filter로 뽑은 OSM 회전제약(type=restriction) XML을 파싱해 osm_turn_restriction에
 * 적재한다. via 노드 좌표 + from/to way의 via 인접 진행방향(bearing)을 임포트 시점에 미리 계산해
 * 저장하므로, 조회(KtdbNetworkConverter/KtdbStreamingConverter의 connection 필터링)는 좌표
 * 계산 없이 각도 비교만 하면 된다.
 *
 * <p>사전 준비(별도 실행, osmium-tool 필요):
 * <pre>
 * osmium tags-filter south-korea-latest.osm.pbf r/type=restriction -o restrictions.osm.pbf
 * osmium cat restrictions.osm.pbf -o restrictions.osm.xml
 * </pre>
 * (osmium이 from/via/to가 참조하는 way/node를 기본적으로 함께 포함시켜준다.)
 *
 * <p>via/from/to 해석 로직은 OsmFacilityConverter의 스냅과 별개로, {@code turn_restriction_check.py}
 * (일회성 리포트 스크립트)에서 검증한 알고리즘을 그대로 Java로 옮긴 것이다 — via node의 좌표를
 * 기준으로 from/to way 양 끝점 중 via에 가까운 쪽에서의 진행방향을 bearing으로 계산한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OsmTurnRestrictionImporter {

    private static final int BATCH_SIZE = 2000;

    private final JdbcTemplate jdbc;

    public record ImportResult(long totalRelations, long resolvedCount, long elapsedMs) {}

    public ImportResult importFromXml(Path osmXmlFile) throws Exception {
        long start = System.currentTimeMillis();
        log.info("[OsmTurnRestrictionImporter] 임포트 시작: {}", osmXmlFile);

        Map<Long, double[]> nodes = new HashMap<>();      // id -> [lat, lon]
        Map<Long, List<Long>> ways = new HashMap<>();     // id -> ordered node ids
        List<long[]> relationRoleRefs = new ArrayList<>(); // 임시 저장용 아님 — 아래서 바로 처리

        record RestrictionCandidate(long id, String restriction, Long fromWay, Long viaNode, Long toWay) {}
        List<RestrictionCandidate> candidates = new ArrayList<>();

        XMLInputFactory factory = XMLInputFactory.newInstance();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);

        try (InputStream in = new BufferedInputStream(new FileInputStream(osmXmlFile.toFile()), 1 << 20)) {
            XMLStreamReader reader = factory.createXMLStreamReader(in);

            String currentElement = null;
            long curId = 0;
            List<Long> curWayNodes = null;
            Map<String, String> curRelTags = null;
            List<Object[]> curMembers = null; // [type(String), ref(Long), role(String)]

            while (reader.hasNext()) {
                int event = reader.next();
                if (event == XMLStreamConstants.START_ELEMENT) {
                    String name = reader.getLocalName();
                    switch (name) {
                        case "node" -> {
                            currentElement = "node";
                            curId = Long.parseLong(reader.getAttributeValue(null, "id"));
                            double lat = Double.parseDouble(reader.getAttributeValue(null, "lat"));
                            double lon = Double.parseDouble(reader.getAttributeValue(null, "lon"));
                            nodes.put(curId, new double[]{lat, lon});
                        }
                        case "way" -> {
                            currentElement = "way";
                            curId = Long.parseLong(reader.getAttributeValue(null, "id"));
                            curWayNodes = new ArrayList<>();
                        }
                        case "relation" -> {
                            currentElement = "relation";
                            curId = Long.parseLong(reader.getAttributeValue(null, "id"));
                            curRelTags = new HashMap<>();
                            curMembers = new ArrayList<>();
                        }
                        case "nd" -> {
                            if (curWayNodes != null) {
                                curWayNodes.add(Long.parseLong(reader.getAttributeValue(null, "ref")));
                            }
                        }
                        case "tag" -> {
                            if ("relation".equals(currentElement) && curRelTags != null) {
                                String k = reader.getAttributeValue(null, "k");
                                String v = reader.getAttributeValue(null, "v");
                                if (k != null) curRelTags.put(k, v);
                            }
                        }
                        case "member" -> {
                            if (curMembers != null) {
                                String type = reader.getAttributeValue(null, "type");
                                String refStr = reader.getAttributeValue(null, "ref");
                                String role = reader.getAttributeValue(null, "role");
                                if (refStr != null) curMembers.add(new Object[]{type, Long.parseLong(refStr), role});
                            }
                        }
                        default -> { }
                    }
                } else if (event == XMLStreamConstants.END_ELEMENT) {
                    String name = reader.getLocalName();
                    if (name.equals("way") && "way".equals(currentElement)) {
                        if (curWayNodes != null && curWayNodes.size() >= 2) ways.put(curId, curWayNodes);
                        currentElement = null;
                    } else if (name.equals("relation") && "relation".equals(currentElement)) {
                        String restriction = curRelTags != null ? curRelTags.get("restriction") : null;
                        if (restriction != null && curMembers != null) {
                            Long fromWay = null, viaNode = null, toWay = null;
                            for (Object[] m : curMembers) {
                                String type = (String) m[0];
                                Long ref = (Long) m[1];
                                String role = (String) m[2];
                                if ("from".equals(role) && "way".equals(type)) fromWay = ref;
                                else if ("via".equals(role) && "node".equals(type)) viaNode = ref;
                                else if ("to".equals(role) && "way".equals(type)) toWay = ref;
                            }
                            if (fromWay != null && viaNode != null && toWay != null) {
                                candidates.add(new RestrictionCandidate(curId, restriction, fromWay, viaNode, toWay));
                            }
                        }
                        currentElement = null;
                    }
                }
            }
            reader.close();
        }

        log.info("[OsmTurnRestrictionImporter] 파싱 완료: 노드 {}개, way {}개, restriction 후보 {}개",
                nodes.size(), ways.size(), candidates.size());

        jdbc.execute("TRUNCATE osm_turn_restriction");

        List<Object[]> batch = new ArrayList<>(BATCH_SIZE);
        long resolvedCount = 0;
        for (var c : candidates) {
            double[] via = nodes.get(c.viaNode());
            if (via == null) continue;
            Double fromBearing = wayBearingNearNode(ways, nodes, c.fromWay(), via, true);
            Double toBearing = wayBearingNearNode(ways, nodes, c.toWay(), via, false);
            // 방향 계산에 실패해도 via 위치만으로 저장 — 조회 측에서 bearing null이면 매칭 안 되게 처리
            batch.add(new Object[]{c.id(), c.restriction(), via[0], via[1], fromBearing, toBearing, via[1], via[0]});
            if (fromBearing != null && toBearing != null) resolvedCount++;
            if (batch.size() >= BATCH_SIZE) { flush(batch); batch.clear(); }
        }
        if (!batch.isEmpty()) flush(batch);

        jdbc.update("DELETE FROM osm_turn_restriction_import_meta");
        jdbc.update("INSERT INTO osm_turn_restriction_import_meta " +
                        "(id, imported_at, source_file, total_relations, resolved_count) VALUES (1, ?, ?, ?, ?)",
                Timestamp.valueOf(LocalDateTime.now()), osmXmlFile.toString(), candidates.size(), resolvedCount);

        long elapsed = System.currentTimeMillis() - start;
        log.info("[OsmTurnRestrictionImporter] 완료: 후보 {}개 중 방향 해석 성공 {}개 ({}ms)",
                candidates.size(), resolvedCount, elapsed);
        return new ImportResult(candidates.size(), resolvedCount, elapsed);
    }

    private void flush(List<Object[]> batch) {
        jdbc.batchUpdate(
                "INSERT INTO osm_turn_restriction (id, restriction, via_lat, via_lon, from_bearing, to_bearing, geom) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                        "ON CONFLICT (id) DO NOTHING",
                batch);
    }

    /**
     * way의 두 끝점 중 via에 더 가까운 쪽에서의 진행방향(bearing, 도) 계산.
     * @param into true면 "via로 들어오는 방향"(from way), false면 "via에서 나가는 방향"(to way)
     */
    private static Double wayBearingNearNode(Map<Long, List<Long>> ways, Map<Long, double[]> nodes,
                                              long wayId, double[] via, boolean into) {
        List<Long> nd = ways.get(wayId);
        if (nd == null || nd.size() < 2) return null;
        double[] p0 = nodes.get(nd.get(0));
        double[] p1 = nodes.get(nd.get(nd.size() - 1));
        if (p0 == null || p1 == null) return null;

        double d0 = haversineM(via[0], via[1], p0[0], p0[1]);
        double d1 = haversineM(via[0], via[1], p1[0], p1[1]);
        double[] a, b; // a=via에 가까운 끝점, b=그 옆 노드
        if (d0 <= d1) {
            a = nodes.get(nd.get(0));
            b = nodes.get(nd.get(Math.min(1, nd.size() - 1)));
        } else {
            a = nodes.get(nd.get(nd.size() - 1));
            b = nodes.get(nd.get(Math.max(0, nd.size() - 2)));
        }
        if (a == null || b == null) return null;
        // from(들어오는 방향): b->a(=via쪽), to(나가는 방향): a(=via쪽)->b
        return into ? bearingDeg(b[0], b[1], a[0], a[1]) : bearingDeg(a[0], a[1], b[0], b[1]);
    }

    static double haversineM(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371000.0;
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dphi = Math.toRadians(lat2 - lat1);
        double dlmb = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dphi / 2) * Math.sin(dphi / 2)
                + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) * Math.sin(dlmb / 2);
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    static double bearingDeg(double lat1, double lon1, double lat2, double lon2) {
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dl = Math.toRadians(lon2 - lon1);
        double y = Math.sin(dl) * Math.cos(p2);
        double x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return (Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
    }

    static double angleDiff(double a, double b) {
        double d = Math.abs(a - b) % 360;
        return Math.min(d, 360 - d);
    }
}
