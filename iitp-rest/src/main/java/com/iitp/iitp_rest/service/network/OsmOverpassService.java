package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.osm.OsmNode;
import com.iitp.iitp_rest.model.osm.OsmWay;
import lombok.extern.log4j.Log4j2;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Log4j2
@Service
public class OsmOverpassService {

    private static final List<String> OVERPASS_URLS = List.of(
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
    );

    /** 주요 도로 유형 (고속도로·국도·주요간선도로·보조간선도로·집산도로 및 진입로) */
    private static final String HIGHWAY_FILTER =
            "motorway|trunk|primary|secondary|tertiary" +
            "|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";

    private final RestTemplate restTemplate = new RestTemplate();

    private static final String ROUTE_FILTER = "bus|trolleybus|subway|train|tram|rail";

    /**
     * bbox(south, west, north, east) 범위의 OSM 데이터를 OSM XML 형식으로 반환.
     * 도로 네트워크(highway way)와 대중교통 노선 relation + bbox 내 멤버 way만 포함.
     * netconvert 등 외부 도구에 직접 전달할 때 사용.
     */
    public byte[] queryBboxAsXml(double south, double west, double north, double east) {
        // route relation의 멤버 way는 bbox 안에 있는 것만 가져와 범위 초과 방지
        String query = String.format(
                "[out:xml][timeout:90];\n" +
                "relation[\"route\"~\"^(%s)$\"](%.7f,%.7f,%.7f,%.7f)->.routeRels;\n" +
                "(\n" +
                "  way[\"highway\"~\"^(%s)$\"][\"access\"!=\"no\"][\"access\"!=\"private\"](%.7f,%.7f,%.7f,%.7f);\n" +
                "  >;\n" +
                "  .routeRels;\n" +
                "  way(r.routeRels)(%.7f,%.7f,%.7f,%.7f);\n" +
                "  >;\n" +
                ");\n" +
                "out body;",
                ROUTE_FILTER,
                south, west, north, east,
                HIGHWAY_FILTER,
                south, west, north, east,
                south, west, north, east
        );
        log.info("Overpass XML query (bbox: {},{},{},{})", south, west, north, east);
        return executeRaw(query);
    }

    /**
     * bbox(south, west, north, east) 범위의 OSM 차량 도로 데이터를 Overpass API로 조회.
     * - living_street, service(주차장·진입로) 제외
     * - access=no/private 제외
     */
    public Map<String, Object> queryBbox(double south, double west, double north, double east) {
        String query = String.format(
                "[out:json][timeout:60];\n" +
                "(\n" +
                "  way[\"highway\"~\"^(%s)$\"][\"access\"!=\"no\"][\"access\"!=\"private\"](%.7f,%.7f,%.7f,%.7f);\n" +
                "  >;\n" +
                ");\n" +
                "out body;",
                HIGHWAY_FILTER,
                south, west, north, east
        );

        log.info("Overpass query (bbox: {},{},{},{}):\n{}", south, west, north, east, query);
        return execute(query);
    }

    private static final int MAX_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 5000L;
    private static final long RATE_LIMIT_DELAY_MS = 15000L;

    private byte[] executeRaw(String query) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("data", query);
        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(body, headers);

        RuntimeException lastEx = null;
        for (int urlIdx = 0; urlIdx < OVERPASS_URLS.size(); urlIdx++) {
            String url = OVERPASS_URLS.get(urlIdx);
            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    ResponseEntity<byte[]> response = restTemplate.exchange(url, HttpMethod.POST, request, byte[].class);
                    if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                        throw new RuntimeException("Overpass API 호출 실패: " + response.getStatusCode());
                    }
                    return response.getBody();
                } catch (org.springframework.web.client.HttpClientErrorException e) {
                    if (e.getStatusCode().value() == 429) {
                        log.warn("Overpass 요청 제한 [{}/{}] {}회 시도 - {}ms 대기 후 재시도",
                                urlIdx + 1, OVERPASS_URLS.size(), attempt, RATE_LIMIT_DELAY_MS);
                        lastEx = e;
                        if (attempt < MAX_RETRIES) {
                            try { Thread.sleep(RATE_LIMIT_DELAY_MS); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                        } else {
                            break; // 다음 미러로
                        }
                    } else {
                        throw e;
                    }
                } catch (org.springframework.web.client.HttpServerErrorException e) {
                    lastEx = e;
                    if (attempt < MAX_RETRIES) {
                        try { Thread.sleep(RETRY_DELAY_MS * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    }
                } catch (org.springframework.web.client.ResourceAccessException e) {
                    lastEx = new RuntimeException(e.getMessage(), e);
                    if (attempt < MAX_RETRIES) {
                        try { Thread.sleep(RETRY_DELAY_MS * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    }
                }
            }
            log.warn("Overpass 미러 {} 실패, 다음 미러로 전환", url);
        }
        throw lastEx != null ? lastEx : new RuntimeException("Overpass API 호출 실패 (모든 미러 소진)");
    }

    /**
     * 반환: {"nodes": List<OsmNode>, "ways": List<OsmWay>}
     * 429 rate limit 시 미러 서버로 자동 전환
     */
    private Map<String, Object> execute(String query) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("data", query);
        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(body, headers);

        RuntimeException lastEx = null;
        for (int urlIdx = 0; urlIdx < OVERPASS_URLS.size(); urlIdx++) {
            String url = OVERPASS_URLS.get(urlIdx);
            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, request, String.class);
                    if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                        throw new RuntimeException("Overpass API 호출 실패: " + response.getStatusCode());
                    }
                    return parse(response.getBody());
                } catch (org.springframework.web.client.HttpClientErrorException e) {
                    if (e.getStatusCode().value() == 429) {
                        log.warn("Overpass 요청 제한 [{}/{}] {}회 시도 - {}ms 대기 후 재시도",
                                urlIdx + 1, OVERPASS_URLS.size(), attempt, RATE_LIMIT_DELAY_MS);
                        lastEx = e;
                        if (attempt < MAX_RETRIES) {
                            try { Thread.sleep(RATE_LIMIT_DELAY_MS); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                        } else {
                            break; // 다음 미러로
                        }
                    } else {
                        throw e;
                    }
                } catch (org.springframework.web.client.HttpServerErrorException e) {
                    lastEx = e;
                    log.warn("Overpass API 오류 [{}/{}] (시도 {}/{}): {}",
                            urlIdx + 1, OVERPASS_URLS.size(), attempt, MAX_RETRIES, e.getStatusCode());
                    if (attempt < MAX_RETRIES) {
                        try { Thread.sleep(RETRY_DELAY_MS * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    }
                } catch (org.springframework.web.client.ResourceAccessException e) {
                    lastEx = new RuntimeException(e.getMessage(), e);
                    log.warn("Overpass 연결 오류 [{}/{}] (시도 {}/{}): {}",
                            urlIdx + 1, OVERPASS_URLS.size(), attempt, MAX_RETRIES, e.getMessage());
                    if (attempt < MAX_RETRIES) {
                        try { Thread.sleep(RETRY_DELAY_MS * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    }
                }
            }
            log.warn("Overpass 미러 {} 실패, 다음 미러로 전환", url);
        }
        throw lastEx != null ? lastEx : new RuntimeException("Overpass API 호출 실패 (모든 미러 소진)");
    }

    /**
     * bbox 내 시설물(버스정류장, 철도역, 버스노선, 철도노선) 조회.
     * 반환: {
     *   "busStops":    List<OsmNode>,   -- highway=bus_stop
     *   "railStations": List<OsmNode>,  -- railway=station|halt|tram_stop
     *   "busRoutes":   List<OsmRelation>, -- route=bus|trolleybus
     *   "railRoutes":  List<OsmRelation>  -- route=subway|train|tram|rail
     * }
     */
    public FacilityQueryResult queryFacilities(double south, double west, double north, double east) {
        // 노선 relation → bbox 내 way 멤버만 가져와 형상 구성
        // way(r.routes)(bbox): 범위 초과 방지, .routeWays >: 해당 way의 노드만 재귀
        String query = String.format(
            "[out:json][timeout:90];\n" +
            "(\n" +
            "  relation[\"route\"~\"^(bus|trolleybus)$\"](%.7f,%.7f,%.7f,%.7f);\n" +
            "  relation[\"route\"~\"^(subway|train|tram|rail)$\"](%.7f,%.7f,%.7f,%.7f);\n" +
            ")->.routes;\n" +
            "way(r.routes)(%.7f,%.7f,%.7f,%.7f)->.routeWays;\n" +
            "(\n" +
            "  .routes;\n" +
            "  .routeWays;\n" +
            "  .routeWays >;\n" +
            "  node[\"highway\"=\"bus_stop\"](%.7f,%.7f,%.7f,%.7f);\n" +
            "  node[\"railway\"~\"^(station|halt|tram_stop|subway_entrance)$\"](%.7f,%.7f,%.7f,%.7f);\n" +
            ");\n" +
            "out body;",
            south, west, north, east,
            south, west, north, east,
            south, west, north, east,
            south, west, north, east,
            south, west, north, east
        );
        log.info("Overpass 시설물 쿼리: bbox=({},{},{},{})", south, west, north, east);
        return parseFacilities(execute(query));
    }

    public record FacilityQueryResult(
        List<OsmNode> busStops,
        List<OsmNode> railStations,
        List<OsmRelation> busRoutes,
        List<OsmRelation> railRoutes,
        List<OsmNode> allNodes,
        List<OsmWay> allWays
    ) {}

    public record OsmRelation(
        long id,
        Map<String, String> tags,
        List<Long> memberNodeIds,
        List<Long> memberWayIds
    ) {
        public String getTag(String key) { return tags != null ? tags.get(key) : null; }
    }

    private FacilityQueryResult parseFacilities(Map<String, Object> raw) {
        @SuppressWarnings("unchecked")
        List<OsmNode> allNodes = (List<OsmNode>) raw.get("nodes");
        @SuppressWarnings("unchecked")
        List<OsmWay> allWays = (List<OsmWay>) raw.get("ways");
        @SuppressWarnings("unchecked")
        List<OsmRelation> allRelations = (List<OsmRelation>) raw.getOrDefault("relations", List.of());

        List<OsmNode> busStops    = new ArrayList<>();
        List<OsmNode> railStations = new ArrayList<>();
        for (OsmNode n : allNodes) {
            String hw  = n.getTag("highway");
            String rwy = n.getTag("railway");
            if ("bus_stop".equals(hw)) busStops.add(n);
            else if (rwy != null && rwy.matches("station|halt|tram_stop|subway_entrance")) railStations.add(n);
        }

        List<OsmRelation> busRoutes  = new ArrayList<>();
        List<OsmRelation> railRoutes = new ArrayList<>();
        for (OsmRelation r : allRelations) {
            String route = r.getTag("route");
            if (route == null) continue;
            if (route.matches("bus|trolleybus")) busRoutes.add(r);
            else if (route.matches("subway|train|tram|rail")) railRoutes.add(r);
        }

        log.info("시설물 파싱: 버스정류장 {}개, 철도역 {}개, 버스노선 {}개, 철도노선 {}개",
                busStops.size(), railStations.size(), busRoutes.size(), railRoutes.size());
        List<OsmWay> safeWays = allWays != null ? allWays : List.of();
        log.info("시설물 파싱: 버스정류장 {}개, 철도역 {}개, 버스노선 {}개, 철도노선 {}개, 전체노드 {}개, way {}개",
                busStops.size(), railStations.size(), busRoutes.size(), railRoutes.size(), allNodes.size(), safeWays.size());
        return new FacilityQueryResult(busStops, railStations, busRoutes, railRoutes, allNodes, safeWays);
    }

    private Map<String, Object> parse(String json) {
        JSONObject root = new JSONObject(json);
        JSONArray elements = root.getJSONArray("elements");

        List<OsmNode> nodes = new ArrayList<>();
        List<OsmWay> ways = new ArrayList<>();
        List<OsmRelation> relations = new ArrayList<>();

        for (int i = 0; i < elements.length(); i++) {
            JSONObject el = elements.getJSONObject(i);
            String type = el.getString("type");

            if ("node".equals(type)) {
                OsmNode node = new OsmNode();
                node.setId(el.getLong("id"));
                node.setLat(el.getDouble("lat"));
                node.setLon(el.getDouble("lon"));
                if (el.has("tags")) {
                    Map<String, String> tags = new LinkedHashMap<>();
                    JSONObject tagObj = el.getJSONObject("tags");
                    for (String key : tagObj.keySet()) tags.put(key, tagObj.getString(key));
                    node.setTags(tags);
                }
                nodes.add(node);

            } else if ("way".equals(type)) {
                OsmWay way = new OsmWay();
                way.setId(el.getLong("id"));
                JSONArray nodeRefs = el.getJSONArray("nodes");
                List<Long> nodeIds = new ArrayList<>(nodeRefs.length());
                for (int j = 0; j < nodeRefs.length(); j++) nodeIds.add(nodeRefs.getLong(j));
                way.setNodeIds(nodeIds);
                Map<String, String> tags = new LinkedHashMap<>();
                if (el.has("tags")) {
                    JSONObject tagObj = el.getJSONObject("tags");
                    for (String key : tagObj.keySet()) tags.put(key, tagObj.getString(key));
                }
                way.setTags(tags);
                ways.add(way);

            } else if ("relation".equals(type)) {
                Map<String, String> tags = new LinkedHashMap<>();
                if (el.has("tags")) {
                    JSONObject tagObj = el.getJSONObject("tags");
                    for (String key : tagObj.keySet()) tags.put(key, tagObj.getString(key));
                }
                List<Long> memberNodes = new ArrayList<>();
                List<Long> memberWays  = new ArrayList<>();
                if (el.has("members")) {
                    JSONArray members = el.getJSONArray("members");
                    for (int j = 0; j < members.length(); j++) {
                        JSONObject m = members.getJSONObject(j);
                        String mType = m.getString("type");
                        long mRef = m.getLong("ref");
                        if ("node".equals(mType)) memberNodes.add(mRef);
                        else if ("way".equals(mType)) memberWays.add(mRef);
                    }
                }
                relations.add(new OsmRelation(el.getLong("id"), tags, memberNodes, memberWays));
            }
        }

        log.info("Overpass 응답: 노드 {}개, way {}개, relation {}개",
                nodes.size(), ways.size(), relations.size());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("nodes", nodes);
        result.put("ways", ways);
        result.put("relations", relations);
        return result;
    }
}
