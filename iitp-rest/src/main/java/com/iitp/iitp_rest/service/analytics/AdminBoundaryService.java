package com.iitp.iitp_rest.service.analytics;

import com.iitp.iitp_rest.model.analytics.RegionBoundary;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * VWorld Data API(행정구역 경계, LT_C_AD*)를 시나리오 extent 범위로 조회해 캐시한다.
 *
 * <p>키({@code vworld.api-key})는 iitp-front의 {@code REACT_APP_VWORLD_API_KEY}와 같은 값 —
 * 이미 브라우저 WMTS 타일 URL에 그대로 노출돼 쓰이던 공개 키라 새 비밀이 아니다. 다만 서버사이드
 * 호출은 {@code Referer} 헤더가 없으면 {@code INCORRECT_KEY}로 거부된다(실측 확인 — 값 자체는
 * 검증하지 않는 듯, non-empty면 통과) — 아래 REFERER 상수로 고정 전송.
 *
 * <p>경계는 시나리오 재생 중 바뀌지 않는 정적 데이터라 versionId+tier 단위로 메모리에 캐시하고
 * 재요청하지 않는다(다른 캐시들과 동일한 in-memory ConcurrentHashMap 패턴 — networkCalibrationCache 등).
 */
@Slf4j
@Service
public class AdminBoundaryService {

    @Value("${vworld.api-key}")
    private String apiKey;

    private static final String REFERER = "http://localhost";
    private static final String BASE_URL = "https://api.vworld.kr/req/data";
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 30; // 안전판 (한 시나리오 extent에서 이만큼 나올 일은 없음)

    private static final Map<String, String> TIER_TO_LAYER = Map.of(
            "sido", "LT_C_ADSIDO_INFO",
            "sigungu", "LT_C_ADSIGG_INFO",
            "eupmyeondong", "LT_C_ADEMD_INFO"
    );

    private final RestTemplate restTemplate = new RestTemplate();
    private final Map<String, List<RegionBoundary>> cache = new ConcurrentHashMap<>();

    /**
     * @param tier   "sido" | "sigungu" | "eupmyeondong"
     * @param extent [west, south, east, north] (WGS84) — 보통 시나리오 네트워크 extent
     */
    public List<RegionBoundary> getBoundaries(String versionId, String tier, double[] extent) {
        String layer = TIER_TO_LAYER.get(tier);
        if (layer == null) return List.of();
        String cacheKey = versionId + "_" + tier;
        List<RegionBoundary> cached = cache.get(cacheKey);
        if (cached != null) return cached;

        List<RegionBoundary> result = fetchAll(layer, tier, extent);
        cache.put(cacheKey, result);
        return result;
    }

    private List<RegionBoundary> fetchAll(String layer, String tier, double[] extent) {
        List<RegionBoundary> out = new ArrayList<>();
        String geomFilter = String.format(Locale.US, "BOX(%f,%f,%f,%f)", extent[0], extent[1], extent[2], extent[3]);

        HttpHeaders headers = new HttpHeaders();
        headers.set("Referer", REFERER);
        HttpEntity<Void> request = new HttpEntity<>(headers);

        int page = 1;
        int totalPages = 1;
        while (page <= totalPages && page <= MAX_PAGES) {
            String url = String.format(Locale.US,
                    "%s?service=data&version=2.0&request=GetFeature&format=json&data=%s&key=%s" +
                            "&geomFilter=%s&geometry=true&attribute=true&crs=EPSG:4326&page=%d&size=%d",
                    BASE_URL, layer, apiKey, geomFilter, page, PAGE_SIZE);
            try {
                ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.GET, request, String.class);
                JSONObject root = new JSONObject(resp.getBody()).getJSONObject("response");
                String status = root.optString("status");
                if (!"OK".equals(status)) {
                    if (!"NOT_FOUND".equals(status)) { // 해당 tier가 extent 내에 없을 수 있음(정상)
                        log.warn("[AdminBoundaryService] VWorld 응답 status={} layer={}", status, layer);
                    }
                    break;
                }
                JSONObject pageInfo = root.optJSONObject("page");
                if (pageInfo != null) {
                    totalPages = pageInfo.optInt("total", 1);
                }
                JSONObject result = root.optJSONObject("result");
                JSONObject fc = result != null ? result.optJSONObject("featureCollection") : null;
                JSONArray features = fc != null ? fc.optJSONArray("features") : null;
                if (features != null) {
                    for (int i = 0; i < features.length(); i++) {
                        RegionBoundary b = parseFeature(features.getJSONObject(i), tier);
                        if (b != null) out.add(b);
                    }
                }
            } catch (Exception e) {
                log.error("[AdminBoundaryService] VWorld 호출 실패 layer={} page={}", layer, page, e);
                break;
            }
            page++;
        }
        log.info("[AdminBoundaryService] {} extent=({},{},{},{}) → {}개", tier,
                extent[0], extent[1], extent[2], extent[3], out.size());
        return out;
    }

    private RegionBoundary parseFeature(JSONObject feature, String tier) {
        JSONObject props = feature.optJSONObject("properties");
        JSONObject geometry = feature.optJSONObject("geometry");
        if (props == null || geometry == null) return null;

        String code, name;
        switch (tier) {
            case "sido" -> { code = props.optString("ctprvn_cd"); name = props.optString("ctp_kor_nm"); }
            case "sigungu" -> { code = props.optString("sig_cd"); name = props.optString("sig_kor_nm"); }
            default -> { code = props.optString("emd_cd"); name = props.optString("emd_kor_nm"); }
        }
        if (code == null || code.isBlank()) return null;

        // GeoJSON MultiPolygon: coordinates[polygon][ring][point]=[lon,lat].
        // 안쪽 구멍(hole) 링까지 전부 "외곽선"으로 평탄화한다 — PolygonBoundaryUtils의 기존
        // isInsideAnyRing도 같은 방식(합집합 판정)이라 일관됨. 행정구역 경계는 섬처럼 별도
        // 폴리곤으로 분리되는 경우가 대부분이라 구멍이 실사용에 미치는 영향은 미미하다.
        List<List<double[]>> rings = new ArrayList<>();
        String type = geometry.optString("type");
        JSONArray coords = geometry.optJSONArray("coordinates");
        if (coords == null) return null;
        if ("MultiPolygon".equals(type)) {
            for (int p = 0; p < coords.length(); p++) {
                JSONArray polygon = coords.getJSONArray(p);
                for (int r = 0; r < polygon.length(); r++) {
                    rings.add(parseRing(polygon.getJSONArray(r)));
                }
            }
        } else if ("Polygon".equals(type)) {
            for (int r = 0; r < coords.length(); r++) {
                rings.add(parseRing(coords.getJSONArray(r)));
            }
        } else {
            return null;
        }
        rings.removeIf(ring -> ring.size() < 3);
        if (rings.isEmpty()) return null;
        return new RegionBoundary(code, name, tier, rings);
    }

    private List<double[]> parseRing(JSONArray ringArr) {
        List<double[]> ring = new ArrayList<>(ringArr.length());
        for (int i = 0; i < ringArr.length(); i++) {
            JSONArray pt = ringArr.getJSONArray(i);
            ring.add(new double[]{pt.getDouble(0), pt.getDouble(1)});
        }
        return ring;
    }
}
