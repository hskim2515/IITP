package com.iitp.iitp_rest.service.network;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 공공데이터포털(data.go.kr) "교차로정보서비스"(CrossRoadInfoService, 기관코드 1320000)를
 * 페이지네이션으로 전체 수집해 crossroad_info에 적재한다. PublicTrafficLightImporter와 동일
 * 관례이되, X_COORD/Y_COORD가 소수점 없는 정수(위경도 × 10^7)로 온다는 점만 다르다.
 *
 * <p>⚠️ 실측: numOfRows에 500을 넣어도 페이지당 최대 100건만 반환됨(공식 문서에 명시된
 * 한계는 아니고 실측으로 확인) — PAGE_SIZE=100 고정.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CrossRoadInfoImporter {

    private static final String BASE_URL = "https://apis.data.go.kr/1320000/CrossRoadInfoService/getCrossRoadInfoList";
    private static final int PAGE_SIZE = 100;
    private static final double COORD_SCALE = 1e7;

    @Value("${public-data.traffic-light.service-key:}")
    private String serviceKey;

    private final JdbcTemplate jdbc;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public record ImportResult(long totalCount, long elapsedMs) {}

    public ImportResult importAll() {
        if (serviceKey == null || serviceKey.isBlank()) {
            throw new IllegalStateException("public-data.traffic-light.service-key 가 설정되지 않았습니다.");
        }
        long start = System.currentTimeMillis();
        log.info("[CrossRoadInfoImporter] 임포트 시작");

        jdbc.execute("TRUNCATE crossroad_info");

        long total = 0;
        int pageNo = 1;
        List<Object[]> batch = new ArrayList<>();

        while (true) {
            JsonNode page = fetchPage(pageNo);
            JsonNode items = page.path("items");
            if (!items.isArray() || items.isEmpty()) break;

            for (JsonNode item : items) {
                Double lat = parseScaledCoord(item.path("Y_COORD").asText(null));
                Double lon = parseScaledCoord(item.path("X_COORD").asText(null));
                if (lat == null || lon == null) continue;
                batch.add(new Object[]{
                        text(item, "INT_NO"), text(item, "INT_NM"), text(item, "REGION_CD"),
                        lat, lon, text(item, "UPD_DTIME"), lon, lat
                });
                total++;
            }
            flush(batch);
            batch.clear();

            long totalCount = page.path("totalCount").asLong(0);
            log.info("[CrossRoadInfoImporter] 진행: {}/{}건 (page {})", total, totalCount, pageNo);
            if ((long) pageNo * PAGE_SIZE >= totalCount) break;
            pageNo++;
        }

        jdbc.update("DELETE FROM crossroad_info_import_meta");
        jdbc.update("INSERT INTO crossroad_info_import_meta (id, imported_at, total_count) VALUES (1, ?, ?)",
                Timestamp.valueOf(LocalDateTime.now()), total);

        long elapsed = System.currentTimeMillis() - start;
        log.info("[CrossRoadInfoImporter] 완료: {}건 ({}ms)", total, elapsed);
        return new ImportResult(total, elapsed);
    }

    private JsonNode fetchPage(int pageNo) {
        String url = UriComponentsBuilder.fromUriString(BASE_URL)
                .queryParam("serviceKey", serviceKey)
                .queryParam("pageNo", pageNo)
                .queryParam("numOfRows", PAGE_SIZE)
                .queryParam("type", "json")
                .build(true)
                .toUri()
                .toString();
        String raw = restTemplate.getForObject(url, String.class);
        try {
            JsonNode root = objectMapper.readTree(raw);
            // 이 API는 header/body 래핑 없이 [헤더객체, 아이템...] 형태의 배열을 바로 반환.
            if (!root.isArray() || root.isEmpty()) {
                throw new IllegalStateException("예상치 못한 응답 형식(page " + pageNo + "): " + raw);
            }
            JsonNode header = root.get(0);
            String resultCode = header.path("resultCode").asText("");
            if (!"0".equals(resultCode)) {
                throw new IllegalStateException("API 오류(page " + pageNo + "): " + header.path("resultMsg").asText(""));
            }
            com.fasterxml.jackson.databind.node.ArrayNode items = objectMapper.createArrayNode();
            for (int i = 1; i < root.size(); i++) items.add(root.get(i));
            com.fasterxml.jackson.databind.node.ObjectNode body = objectMapper.createObjectNode();
            body.set("items", items);
            body.put("totalCount", header.path("totalCount").asLong(0));
            return body;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("응답 파싱 실패(page " + pageNo + "): " + e.getMessage(), e);
        }
    }

    private static String text(JsonNode item, String field) {
        JsonNode v = item.path(field);
        return v.isMissingNode() || v.isNull() ? null : v.asText();
    }

    /** "374806239" 같은 소수점 없는 정수 좌표(× 10^7)를 실제 위경도로 변환. */
    private static Double parseScaledCoord(String s) {
        if (s == null || s.isBlank()) return null;
        try { return Double.parseDouble(s) / COORD_SCALE; } catch (NumberFormatException e) { return null; }
    }

    private void flush(List<Object[]> batch) {
        if (batch.isEmpty()) return;
        jdbc.batchUpdate(
                "INSERT INTO crossroad_info (int_no, int_nm, region_cd, lat, lon, upd_dtime, geom) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))",
                batch);
    }
}
