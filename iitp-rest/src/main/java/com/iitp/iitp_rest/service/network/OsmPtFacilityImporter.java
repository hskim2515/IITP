package com.iitp.iitp_rest.service.network;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
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
 * osmium tags-filter로 미리 걸러낸 OSM XML(.osm)을 파싱해 osm_pt_node/osm_pt_way/
 * osm_pt_relation 테이블에 배치 적재한다 — {@link OsmOverpassService}가 매번 공개
 * Overpass API를 호출하는 대신 이 로컬 테이블을 SQL로 조회하게 하기 위한 것
 * (KTDB가 표준노드링크를 PostgreSQL에 직접 넣어두고 조회하는 것과 동일 패턴).
 *
 * <p>대용량(전국) 파일 대응을 위해 StAX 스트리밍 파싱 + JDBC 배치 insert만 쓰고 전체 객체
 * 그래프를 메모리에 올리지 않는다.
 *
 * <p>사전 준비(별도 실행, osmium-tool 필요 — {@code brew install osmium-tool}):
 * <pre>
 * osmium tags-filter south-korea-latest.osm.pbf \
 *   n/highway=bus_stop \
 *   n/railway=station,halt,tram_stop,subway_entrance,stop \
 *   r/route=bus,trolleybus,subway,train,tram,rail \
 *   -o filtered.osm.pbf
 * osmium cat filtered.osm.pbf -o filtered.osm.xml
 * </pre>
 * (osmium tags-filter는 기본적으로 매칭된 relation/way가 참조하는 노드·way도 함께
 * 포함한다 — {@code -R}/{@code --omit-referenced}를 주면 이 동작이 꺼지므로 주지 않는다.)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OsmPtFacilityImporter {

    private static final int BATCH_SIZE = 5000;
    private static final java.util.regex.Pattern ROUTE_FILTER =
            java.util.regex.Pattern.compile("bus|trolleybus|subway|train|tram|rail");

    private final JdbcTemplate jdbc;

    public record ImportResult(long nodeCount, long wayCount, long relationCount, long elapsedMs) {}

    public ImportResult importFromXml(Path osmXmlFile) throws Exception {
        long start = System.currentTimeMillis();
        long[] counts = {0, 0, 0}; // node, way, relation

        log.info("[OsmPtFacilityImporter] 임포트 시작: {}", osmXmlFile);
        jdbc.execute("TRUNCATE osm_pt_node, osm_pt_way, osm_pt_relation");

        XMLInputFactory factory = XMLInputFactory.newInstance();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);

        try (InputStream in = new BufferedInputStream(new FileInputStream(osmXmlFile.toFile()), 1 << 20)) {
            XMLStreamReader reader = factory.createXMLStreamReader(in);

            List<Object[]> nodeBatch = new ArrayList<>(BATCH_SIZE);
            List<Object[]> wayBatch = new ArrayList<>(BATCH_SIZE);
            List<Object[]> relationBatch = new ArrayList<>(BATCH_SIZE);

            String currentElement = null;
            long curId = 0;
            double curLat = 0, curLon = 0;
            Map<String, String> curTags = null;
            List<Long> curNodeIds = null;
            List<Map<String, Object>> curMembers = null;

            while (reader.hasNext()) {
                int event = reader.next();
                if (event == XMLStreamConstants.START_ELEMENT) {
                    String name = reader.getLocalName();
                    switch (name) {
                        case "node" -> {
                            currentElement = "node";
                            curId = Long.parseLong(reader.getAttributeValue(null, "id"));
                            curLat = Double.parseDouble(reader.getAttributeValue(null, "lat"));
                            curLon = Double.parseDouble(reader.getAttributeValue(null, "lon"));
                            curTags = null;
                        }
                        case "way" -> {
                            currentElement = "way";
                            curId = Long.parseLong(reader.getAttributeValue(null, "id"));
                            curTags = null;
                            curNodeIds = new ArrayList<>();
                        }
                        case "relation" -> {
                            currentElement = "relation";
                            curId = Long.parseLong(reader.getAttributeValue(null, "id"));
                            curTags = null;
                            curMembers = new ArrayList<>();
                        }
                        case "tag" -> {
                            if (currentElement != null) {
                                if (curTags == null) curTags = new HashMap<>();
                                String k = reader.getAttributeValue(null, "k");
                                String v = reader.getAttributeValue(null, "v");
                                if (k != null) curTags.put(k, v);
                            }
                        }
                        case "nd" -> {
                            if (curNodeIds != null) {
                                String ref = reader.getAttributeValue(null, "ref");
                                if (ref != null) curNodeIds.add(Long.parseLong(ref));
                            }
                        }
                        case "member" -> {
                            if (curMembers != null) {
                                Map<String, Object> m = new HashMap<>();
                                m.put("type", reader.getAttributeValue(null, "type"));
                                String ref = reader.getAttributeValue(null, "ref");
                                if (ref != null) m.put("ref", Long.parseLong(ref));
                                m.put("role", reader.getAttributeValue(null, "role"));
                                curMembers.add(m);
                            }
                        }
                        default -> { /* bounds 등 무시 */ }
                    }
                } else if (event == XMLStreamConstants.END_ELEMENT) {
                    String name = reader.getLocalName();
                    if (name.equals("node") && "node".equals(currentElement)) {
                        nodeBatch.add(new Object[]{curId, curLat, curLon, toJson(curTags), curLon, curLat});
                        counts[0]++;
                        currentElement = null;
                        if (nodeBatch.size() >= BATCH_SIZE) { flushNodes(nodeBatch); nodeBatch.clear(); }
                    } else if (name.equals("way") && "way".equals(currentElement)) {
                        if (curNodeIds != null && !curNodeIds.isEmpty()) {
                            wayBatch.add(new Object[]{curId, toIdArrayJson(curNodeIds)});
                            counts[1]++;
                        }
                        currentElement = null;
                        if (wayBatch.size() >= BATCH_SIZE) { flushWays(wayBatch); wayBatch.clear(); }
                    } else if (name.equals("relation") && "relation".equals(currentElement)) {
                        String route = curTags != null ? curTags.get("route") : null;
                        if (route != null && ROUTE_FILTER.matcher(route).matches()) {
                            relationBatch.add(new Object[]{curId, toJson(curTags), toMembersJson(curMembers)});
                            counts[2]++;
                        }
                        currentElement = null;
                        if (relationBatch.size() >= BATCH_SIZE) { flushRelations(relationBatch); relationBatch.clear(); }
                    }
                }
            }
            if (!nodeBatch.isEmpty()) flushNodes(nodeBatch);
            if (!wayBatch.isEmpty()) flushWays(wayBatch);
            if (!relationBatch.isEmpty()) flushRelations(relationBatch);
            reader.close();
        }

        log.info("[OsmPtFacilityImporter] 파싱/적재 완료: 노드 {}개, way {}개, relation {}개 ({}ms)",
                counts[0], counts[1], counts[2], System.currentTimeMillis() - start);

        computeWayBboxes();
        computeRelationBboxes();

        jdbc.update("DELETE FROM osm_pt_import_meta");
        jdbc.update("INSERT INTO osm_pt_import_meta " +
                        "(id, imported_at, source_file, node_count, way_count, relation_count) " +
                        "VALUES (1, ?, ?, ?, ?, ?)",
                Timestamp.valueOf(LocalDateTime.now()), osmXmlFile.toString(),
                counts[0], counts[1], counts[2]);

        long elapsed = System.currentTimeMillis() - start;
        log.info("[OsmPtFacilityImporter] 전체 완료 ({}ms)", elapsed);
        return new ImportResult(counts[0], counts[1], counts[2], elapsed);
    }

    private void flushNodes(List<Object[]> batch) {
        jdbc.batchUpdate(
                "INSERT INTO osm_pt_node (id, lat, lon, tags, geom) " +
                        "VALUES (?, ?, ?, ?::jsonb, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                        "ON CONFLICT (id) DO NOTHING",
                batch);
    }

    private void flushWays(List<Object[]> batch) {
        jdbc.batchUpdate(
                "INSERT INTO osm_pt_way (id, node_ids) VALUES (?, ?::jsonb) ON CONFLICT (id) DO NOTHING",
                batch);
    }

    private void flushRelations(List<Object[]> batch) {
        jdbc.batchUpdate(
                "INSERT INTO osm_pt_relation (id, tags, members) VALUES (?, ?::jsonb, ?::jsonb) " +
                        "ON CONFLICT (id) DO NOTHING",
                batch);
    }

    /** way의 node_ids가 참조하는 실제 노드 좌표들의 envelope를 bbox로 저장 (공간 인덱스 필터용). */
    private void computeWayBboxes() {
        log.info("[OsmPtFacilityImporter] way bbox 계산 중...");
        jdbc.update(
                "UPDATE osm_pt_way w SET bbox = sub.bbox FROM (" +
                "  SELECT w2.id, ST_Envelope(ST_Collect(n.geom)) AS bbox" +
                "  FROM osm_pt_way w2" +
                "  CROSS JOIN LATERAL jsonb_array_elements_text(w2.node_ids) AS nid(v)" +
                "  JOIN osm_pt_node n ON n.id = nid.v::bigint" +
                "  GROUP BY w2.id" +
                ") sub WHERE w.id = sub.id");
    }

    /** relation의 way/node 멤버들이 커버하는 영역의 envelope를 bbox로 저장. */
    private void computeRelationBboxes() {
        log.info("[OsmPtFacilityImporter] relation bbox 계산 중...");
        jdbc.update(
                "UPDATE osm_pt_relation r SET bbox = sub.bbox FROM (" +
                "  SELECT rel.id, ST_Envelope(ST_Collect(g.geom)) AS bbox" +
                "  FROM osm_pt_relation rel" +
                "  CROSS JOIN LATERAL jsonb_array_elements(rel.members) AS m" +
                "  LEFT JOIN osm_pt_way w ON (m->>'type') = 'way' AND w.id = (m->>'ref')::bigint" +
                "  LEFT JOIN osm_pt_node n ON (m->>'type') = 'node' AND n.id = (m->>'ref')::bigint" +
                "  CROSS JOIN LATERAL (VALUES (COALESCE(w.bbox, n.geom))) AS g(geom)" +
                "  WHERE g.geom IS NOT NULL" +
                "  GROUP BY rel.id" +
                ") sub WHERE r.id = sub.id");
    }

    private static String toJson(Map<String, String> tags) {
        if (tags == null || tags.isEmpty()) return "null";
        return new JSONObject(tags).toString();
    }

    private static String toIdArrayJson(List<Long> ids) {
        return new JSONArray(ids).toString();
    }

    private static String toMembersJson(List<Map<String, Object>> members) {
        if (members == null) return "[]";
        JSONArray arr = new JSONArray();
        for (Map<String, Object> m : members) {
            JSONObject o = new JSONObject();
            o.put("type", m.get("type"));
            o.put("ref", m.get("ref"));
            if (m.get("role") != null) o.put("role", m.get("role"));
            arr.put(o);
        }
        return arr.toString();
    }
}
