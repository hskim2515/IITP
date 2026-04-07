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

    private static final String OVERPASS_URL = "https://overpass-api.de/api/interpreter";

    /** 주요 도로 유형 (고속도로·국도·주요간선도로·보조간선도로·집산도로 및 진입로) */
    private static final String HIGHWAY_FILTER =
            "motorway|trunk|primary|secondary|tertiary" +
            "|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";

    private final RestTemplate restTemplate = new RestTemplate();

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
    private static final long RETRY_DELAY_MS = 3000L;

    /**
     * 반환: {"nodes": List<OsmNode>, "ways": List<OsmWay>}
     * 504/503 등 서버 오류 시 최대 MAX_RETRIES회 재시도
     */
    private Map<String, Object> execute(String query) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("data", query);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(body, headers);

        RuntimeException lastEx = null;
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                ResponseEntity<String> response = restTemplate.exchange(
                        OVERPASS_URL, HttpMethod.POST, request, String.class);

                if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                    throw new RuntimeException("Overpass API 호출 실패: " + response.getStatusCode());
                }
                return parse(response.getBody());

            } catch (org.springframework.web.client.HttpServerErrorException e) {
                lastEx = e;
                log.warn("Overpass API 오류 (시도 {}/{}): {} - {}ms 후 재시도",
                        attempt, MAX_RETRIES, e.getStatusCode(), RETRY_DELAY_MS);
                if (attempt < MAX_RETRIES) {
                    try { Thread.sleep(RETRY_DELAY_MS * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                }
            } catch (org.springframework.web.client.ResourceAccessException e) {
                lastEx = new RuntimeException(e.getMessage(), e);
                log.warn("Overpass API 연결 오류 (시도 {}/{}): {}", attempt, MAX_RETRIES, e.getMessage());
                if (attempt < MAX_RETRIES) {
                    try { Thread.sleep(RETRY_DELAY_MS * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                }
            }
        }
        throw lastEx != null ? lastEx : new RuntimeException("Overpass API 호출 실패");
    }

    private Map<String, Object> parse(String json) {
        JSONObject root = new JSONObject(json);
        JSONArray elements = root.getJSONArray("elements");

        List<OsmNode> nodes = new ArrayList<>();
        List<OsmWay> ways = new ArrayList<>();

        for (int i = 0; i < elements.length(); i++) {
            JSONObject el = elements.getJSONObject(i);
            String type = el.getString("type");

            if ("node".equals(type)) {
                OsmNode node = new OsmNode();
                node.setId(el.getLong("id"));
                node.setLat(el.getDouble("lat"));
                node.setLon(el.getDouble("lon"));
                nodes.add(node);

            } else if ("way".equals(type)) {
                OsmWay way = new OsmWay();
                way.setId(el.getLong("id"));

                JSONArray nodeRefs = el.getJSONArray("nodes");
                List<Long> nodeIds = new ArrayList<>(nodeRefs.length());
                for (int j = 0; j < nodeRefs.length(); j++) {
                    nodeIds.add(nodeRefs.getLong(j));
                }
                way.setNodeIds(nodeIds);

                Map<String, String> tags = new LinkedHashMap<>();
                if (el.has("tags")) {
                    JSONObject tagObj = el.getJSONObject("tags");
                    for (String key : tagObj.keySet()) {
                        tags.put(key, tagObj.getString(key));
                    }
                }
                way.setTags(tags);
                ways.add(way);
            }
        }

        log.info("Overpass 응답: 노드 {}개, way {}개", nodes.size(), ways.size());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("nodes", nodes);
        result.put("ways", ways);
        return result;
    }
}
