package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.osm.OsmNode;
import com.iitp.iitp_rest.model.osm.OsmWay;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

/**
 * {@link OsmOverpassService.FacilityQueryResult}를 osm_pt_node/osm_pt_way/osm_pt_relation
 * (로컬 DB, {@link OsmPtFacilityImporter}로 미리 적재됨)에서 SQL로 구성한다 — 매번 공개
 * Overpass API를 호출하던 것을 대체(실측: 강남역 인근 bbox에서 1분 이상 → 이걸로 밀리초 단위).
 *
 * <p>반환 타입/필드 구성은 {@code OsmOverpassService.parseFacilities()}가 Overpass 응답으로
 * 만들던 것과 동일하게 맞춘다 — {@link OsmFacilityConverter}는 입력 출처가 바뀐 걸 몰라도 되게.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class OsmPtFacilityRepository {

    private final JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate namedJdbc;

    private NamedParameterJdbcTemplate named() {
        if (namedJdbc == null) namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        return namedJdbc;
    }

    /** osm_pt_import_meta에 임포트 기록이 있으면 true — 없으면 호출측이 Overpass로 폴백. */
    public boolean hasLocalData() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM osm_pt_import_meta", Long.class);
        return count != null && count > 0;
    }

    public OsmOverpassService.FacilityQueryResult queryFacilities(double south, double west, double north, double east) {
        MapSqlParameterSource bboxParams = new MapSqlParameterSource()
                .addValue("west", west).addValue("south", south)
                .addValue("east", east).addValue("north", north);

        List<OsmNode> busStops = named().query(
                "SELECT id, lat, lon, tags FROM osm_pt_node " +
                        "WHERE tags->>'highway' = 'bus_stop' " +
                        "AND geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                bboxParams, this::mapNode);

        List<OsmNode> railStations = named().query(
                "SELECT id, lat, lon, tags FROM osm_pt_node " +
                        "WHERE tags->>'railway' ~ '^(station|halt|tram_stop)$' " +
                        "AND geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                bboxParams, this::mapNode);

        // subway_entrance(지하철 출입구)는 역이 아니다 — railStations와 섞이면 출입구
        // 하나하나가 독립된 "역"으로 잘못 변환된다(OsmOverpassService.parseFacilities의
        // 동일 버그 수정과 짝 맞춤). 별도로 조회해 OsmFacilityConverter가 가장 가까운
        // 진짜 역의 exit로 매칭하게 한다.
        List<OsmNode> railExits = named().query(
                "SELECT id, lat, lon, tags FROM osm_pt_node " +
                        "WHERE tags->>'railway' = 'subway_entrance' " +
                        "AND geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                bboxParams, this::mapNode);

        List<Map<String, Object>> busRelRows = named().queryForList(
                "SELECT id, tags, members FROM osm_pt_relation " +
                        "WHERE tags->>'route' ~ '^(bus|trolleybus)$' " +
                        "AND bbox && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                bboxParams);
        List<Map<String, Object>> railRelRows = named().queryForList(
                "SELECT id, tags, members FROM osm_pt_relation " +
                        "WHERE tags->>'route' ~ '^(subway|train|tram|rail)$' " +
                        "AND bbox && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                bboxParams);

        List<OsmOverpassService.OsmRelation> busRoutes = busRelRows.stream().map(this::mapRelation).toList();
        List<OsmOverpassService.OsmRelation> railRoutes = railRelRows.stream().map(this::mapRelation).toList();

        // relation이 참조하는 way id 전부 수집 → bbox와 무관하게(Overpass의 .routeWays > 와 동일
        // 취지 — way 자체는 bbox로 거르되, 그 way의 노드/geometry는 잘리지 않게) 그 way들의
        // node_ids까지 가져온다. way 자체도 bbox 교차하는 것만(원래 쿼리의 way(r.routes)(bbox)
        // 취지) — 그래서 way 목록도 bbox 필터를 건다.
        Set<Long> referencedWayIds = new LinkedHashSet<>();
        for (var rel : busRoutes) referencedWayIds.addAll(rel.memberWayIds());
        for (var rel : railRoutes) referencedWayIds.addAll(rel.memberWayIds());

        List<OsmWay> allWays = new ArrayList<>();
        Set<Long> nodeIdsNeeded = new LinkedHashSet<>();
        if (!referencedWayIds.isEmpty()) {
            // ⚠️ 실측 성능 문제: 버스 노선 많은 지역(강남 일대)은 relation member(주로 way id)가
            // 2만개를 넘는다 — NamedParameterJdbcTemplate의 IN (:ids)는 이걸 위치 파라미터
            // 수만 개짜리 SQL로 그대로 펼쳐서(?,?,?,...) 응답이 안 올 정도로 느려짐(120초+
            // 타임아웃 재현). = ANY(string_to_array(...)::bigint[])로 배열 파라미터 1개만
            // 바인딩하도록 바꿔 해결.
            List<Map<String, Object>> wayRows = named().queryForList(
                    "SELECT id, node_ids FROM osm_pt_way WHERE id = ANY(string_to_array(:idsCsv, ',')::bigint[]) " +
                            "AND bbox && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                    new MapSqlParameterSource()
                            .addValue("idsCsv", toCsv(referencedWayIds)).addValues(bboxParams.getValues()));
            for (var row : wayRows) {
                long wayId = ((Number) row.get("id")).longValue();
                JSONArray idsJson = new JSONArray(row.get("node_ids").toString());
                List<Long> ids = new ArrayList<>(idsJson.length());
                for (int i = 0; i < idsJson.length(); i++) ids.add(idsJson.getLong(i));
                OsmWay way = new OsmWay();
                way.setId(wayId);
                way.setNodeIds(ids);
                allWays.add(way);
                nodeIdsNeeded.addAll(ids);
            }
        }

        // relation의 직접 node 멤버(철도 "stop" role 등, way 자식이 아닌 노드)도 필요 — bbox
        // 무관(도시 전체 노선의 일부일 수 있음, 이름 매칭에 쓰임)
        for (var rel : busRoutes) nodeIdsNeeded.addAll(rel.memberNodeIds());
        for (var rel : railRoutes) nodeIdsNeeded.addAll(rel.memberNodeIds());
        busStops.forEach(n -> nodeIdsNeeded.add(n.getId()));
        railStations.forEach(n -> nodeIdsNeeded.add(n.getId()));
        railExits.forEach(n -> nodeIdsNeeded.add(n.getId()));

        List<OsmNode> allNodes;
        if (nodeIdsNeeded.isEmpty()) {
            allNodes = new ArrayList<>(busStops);
            allNodes.addAll(railStations);
            allNodes.addAll(railExits);
        } else {
            allNodes = named().query(
                    "SELECT id, lat, lon, tags FROM osm_pt_node WHERE id = ANY(string_to_array(:idsCsv, ',')::bigint[])",
                    new MapSqlParameterSource().addValue("idsCsv", toCsv(nodeIdsNeeded)), this::mapNode);
        }

        log.info("[OsmPtFacilityRepository] bbox=({},{},{},{}) → 버스정류장 {}개, 철도역 {}개, 철도출입구 {}개, " +
                        "버스노선 {}개, 철도노선 {}개, 참조 way {}개, 전체 노드 {}개",
                south, west, north, east, busStops.size(), railStations.size(), railExits.size(),
                busRoutes.size(), railRoutes.size(), allWays.size(), allNodes.size());

        return new OsmOverpassService.FacilityQueryResult(
                busStops, railStations, busRoutes, railRoutes, allNodes, allWays, railExits);
    }

    private OsmNode mapNode(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        OsmNode n = new OsmNode();
        n.setId(rs.getLong("id"));
        n.setLat(rs.getDouble("lat"));
        n.setLon(rs.getDouble("lon"));
        n.setTags(jsonToTags(rs.getString("tags")));
        return n;
    }

    private OsmOverpassService.OsmRelation mapRelation(Map<String, Object> row) {
        long id = ((Number) row.get("id")).longValue();
        // ⚠️ 실측 버그: queryForList()로 읽은 jsonb 컬럼은 PostgreSQL JDBC 드라이버가
        // String이 아니라 PGobject로 채운다(ResultSet.getString()을 직접 쓰는 mapNode와
        // 달리, Map 기반 row는 getObject()를 써서 원시 타입 그대로 담김) — (String) 캐스팅이
        // ClassCastException을 던져 매 호출이 이 메서드에서 죽고 조용히 Overpass API로
        // 폴백하고 있었다(사용자 실측 로그로 발견 — "로컬 DB 시설물 조회 실패" 경고가 매번
        // 찍히고 있었음). null 대비 toString()으로 안전하게 문자열화(바로 아래 members와
        // 동일 방식 — PGobject.toString()은 원본 JSON 텍스트를 그대로 반환).
        Object tagsObj = row.get("tags");
        Map<String, String> tags = jsonToTags(tagsObj == null ? null : tagsObj.toString());
        JSONArray members = new JSONArray(row.get("members").toString());
        List<Long> nodeIds = new ArrayList<>();
        List<Long> wayIds = new ArrayList<>();
        for (int i = 0; i < members.length(); i++) {
            JSONObject m = members.getJSONObject(i);
            String type = m.optString("type", null);
            if (!m.has("ref")) continue;
            long ref = m.getLong("ref");
            if ("way".equals(type)) wayIds.add(ref);
            else if ("node".equals(type)) nodeIds.add(ref);
        }
        return new OsmOverpassService.OsmRelation(id, tags, nodeIds, wayIds);
    }

    private static String toCsv(Collection<Long> ids) {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Long id : ids) {
            if (!first) sb.append(',');
            sb.append(id);
            first = false;
        }
        return sb.toString();
    }

    private static Map<String, String> jsonToTags(String json) {
        if (json == null || json.isBlank() || "null".equals(json)) return null;
        JSONObject obj = new JSONObject(json);
        Map<String, String> tags = new HashMap<>();
        for (String key : obj.keySet()) {
            Object v = obj.get(key);
            tags.put(key, v == null ? null : v.toString());
        }
        return tags;
    }
}
