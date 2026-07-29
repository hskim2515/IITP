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
 * 공공데이터포털(data.go.kr) "전국 교통신호기표준데이터"(tn_pubr_public_traffic_light_api)를
 * 페이지네이션으로 전체 수집해 public_traffic_light에 적재한다. OsmTrafficSignalImporter와
 * 동일 관례(진행 로그, 배치 삽입, import_meta 기록)를 따르되 파일이 아니라 REST API가
 * 소스라는 점만 다르다.
 *
 * <p>⚠️ 실측: ctprvnNm/signguNm 등 지역명 쿼리 파라미터로 필터링을 시도했으나
 * NODATA_ERROR(resultCode=03)만 반환됨 — 이 API는 지역 필터를 지원하지 않는 것으로 보여
 * 전국 데이터(약 9.9만건)를 전량 수집한 뒤 bbox 조회는 로컬 DB(PostGIS geom)에서 처리한다.
 * numOfRows=1000이 페이지당 최대로 확인됨(그 이상 요청해도 무시되고 1000건만 반환).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PublicTrafficLightImporter {

    private static final String BASE_URL = "https://api.data.go.kr/openapi/tn_pubr_public_traffic_light_api";
    private static final int PAGE_SIZE = 1000;
    private static final int BATCH_SIZE = 1000;

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
        log.info("[PublicTrafficLightImporter] 임포트 시작");

        jdbc.execute("TRUNCATE public_traffic_light");

        long total = 0;
        int pageNo = 1;
        List<Object[]> batch = new ArrayList<>(BATCH_SIZE);

        while (true) {
            JsonNode body = fetchPage(pageNo);
            JsonNode items = body.path("items");
            if (!items.isArray() || items.isEmpty()) break;

            for (JsonNode item : items) {
                Double lat = parseDouble(item.path("latitude").asText(null));
                Double lon = parseDouble(item.path("longitude").asText(null));
                if (lat == null || lon == null) continue;
                batch.add(new Object[]{
                        text(item, "ctprvnNm"), text(item, "signguNm"), text(item, "roadRouteNm"),
                        text(item, "lnmadr"), text(item, "rdnmadr"), lat, lon,
                        text(item, "tfclghtManageNo"), text(item, "tfclghtSe"),
                        text(item, "institutionNm"), text(item, "referenceDate"),
                        lon, lat
                });
                total++;
                if (batch.size() >= BATCH_SIZE) { flush(batch); batch.clear(); }
            }

            long totalCount = body.path("totalCount").asLong(0);
            if (pageNo % 10 == 0 || (long) pageNo * PAGE_SIZE >= totalCount) {
                log.info("[PublicTrafficLightImporter] 진행: {}/{}건 (page {})", total, totalCount, pageNo);
            }
            if ((long) pageNo * PAGE_SIZE >= totalCount) break;
            pageNo++;
        }
        if (!batch.isEmpty()) flush(batch);

        jdbc.update("DELETE FROM public_traffic_light_import_meta");
        jdbc.update("INSERT INTO public_traffic_light_import_meta (id, imported_at, total_count) VALUES (1, ?, ?)",
                Timestamp.valueOf(LocalDateTime.now()), total);

        long elapsed = System.currentTimeMillis() - start;
        log.info("[PublicTrafficLightImporter] 완료: {}건 ({}ms)", total, elapsed);
        return new ImportResult(total, elapsed);
    }

    private JsonNode fetchPage(int pageNo) {
        String url = UriComponentsBuilder.fromUriString(BASE_URL)
                .queryParam("serviceKey", serviceKey)
                .queryParam("pageNo", pageNo)
                .queryParam("numOfRows", PAGE_SIZE)
                .queryParam("type", "json")
                .build(true) // serviceKey가 이미 인코딩된 키라 재인코딩 방지
                .toUri()
                .toString();
        String raw = restTemplate.getForObject(url, String.class);
        try {
            JsonNode root = objectMapper.readTree(raw);
            JsonNode response = root.path("response");
            String resultCode = response.path("header").path("resultCode").asText("");
            if (!"00".equals(resultCode)) {
                throw new IllegalStateException("API 오류(page " + pageNo + "): " +
                        response.path("header").path("resultMsg").asText(""));
            }
            return response.path("body");
        } catch (Exception e) {
            throw new RuntimeException("응답 파싱 실패(page " + pageNo + "): " + e.getMessage(), e);
        }
    }

    private static String text(JsonNode item, String field) {
        JsonNode v = item.path(field);
        return v.isMissingNode() || v.isNull() ? null : v.asText();
    }

    private static Double parseDouble(String s) {
        if (s == null || s.isBlank()) return null;
        try { return Double.parseDouble(s); } catch (NumberFormatException e) { return null; }
    }

    private void flush(List<Object[]> batch) {
        jdbc.batchUpdate(
                "INSERT INTO public_traffic_light " +
                        "(ctprvn_nm, signgu_nm, road_route_nm, lnmadr, rdnmadr, lat, lon, " +
                        " tfclght_manage_no, tfclght_se, institution_nm, reference_date, geom) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))",
                batch);
    }
}
