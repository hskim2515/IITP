package com.iitp.iitp_rest.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * KTDB 임포트의 폴리곤/파일(SHP·GeoJSON) 경계 필터 — 프론트가 그리거나 업로드한 경계로
 * 표준 사각형(bbox) 대신 임의 모양의 영역만 골라 임포트하고 싶다는 요청에 대응한다.
 *
 * <p>PostGIS 확장(postgis/postgis 이미지)이 DB에 떠 있긴 하지만 기존 코드 어디서도
 * {@code ST_*} 함수를 쓴 적이 없어 이번에 처음 검증해야 하는 새 통합 지점이 된다 — 리스크를
 * 낮추기 위해 PostGIS 도입 대신 애플리케이션 레벨 point-in-polygon(레이캐스팅)을 쓴다.
 * 기존 bbox 조회(findByBbox)로 1차 후보를 뽑은 뒤 이 유틸로 한 번 더 거른다.
 */
public final class PolygonBoundaryUtils {

    private PolygonBoundaryUtils() {}

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 프론트가 보내는 {@code [[[lon,lat],...], [[lon,lat],...], ...]} 형태의 JSON(링 목록,
     * 파일에 다각형이 여러 개면 원소가 여러 개)을 파싱한다. 각 링은 최소 3점이 있어야 유효하다.
     *
     * @return 링 목록. json이 null/blank이거나 유효한 링이 하나도 없으면 빈 리스트.
     */
    public static List<List<double[]>> parsePolygonParam(String json) {
        List<List<double[]>> rings = new ArrayList<>();
        if (json == null || json.isBlank()) return rings;
        try {
            JsonNode root = MAPPER.readTree(json);
            if (!root.isArray()) return rings;
            for (JsonNode ringNode : root) {
                if (!ringNode.isArray()) continue;
                List<double[]> ring = new ArrayList<>();
                for (JsonNode pt : ringNode) {
                    if (!pt.isArray() || pt.size() < 2) continue;
                    ring.add(new double[]{pt.get(0).asDouble(), pt.get(1).asDouble()});
                }
                if (ring.size() >= 3) rings.add(ring);
            }
        } catch (Exception ignored) {
            // 파싱 실패 — 폴리곤 없이 순수 bbox로 폴백(호출부가 빈 리스트를 null과 동일하게 취급)
        }
        return rings;
    }

    /**
     * (lon, lat) 점이 rings 중 어느 하나의 내부에라도 있으면 true(합집합 의미 — 여러 다각형을
     * 합쳐 하나의 경계로 쓰는 요구사항에 대응, 진짜 지오메트리 union 없이 "하나라도 내부"로 충분).
     */
    public static boolean isInsideAnyRing(double lon, double lat, List<List<double[]>> rings) {
        if (rings == null) return true; // 폴리곤 미지정 — 필터링 안 함(호출부에서도 null 체크하지만 방어적으로)
        for (List<double[]> ring : rings) {
            if (isInsideRing(lon, lat, ring)) return true;
        }
        return false;
    }

    /**
     * 여러 지역(regions) 중 (lon,lat)을 포함하는 첫 지역을 반환 — 행정구역(시도/시군구/읍면동) 등
     * "이 점이 어느 지역에 속하는가" 단일 배정에 사용(isInsideAnyRing은 "포함되는가" bool만 반환).
     * ringsOf로 지역 타입에 관계없이 재사용 가능(RegionBoundary에 결합하지 않음).
     */
    public static <T> T findContainingRegion(double lon, double lat, List<T> regions,
                                               Function<T, List<List<double[]>>> ringsOf) {
        if (regions == null) return null;
        for (T region : regions) {
            List<List<double[]>> rings = ringsOf.apply(region);
            if (rings == null) continue;
            for (List<double[]> ring : rings) {
                if (isInsideRing(lon, lat, ring)) return region;
            }
        }
        return null;
    }

    /** 표준 레이캐스팅(짝-홀수 규칙) point-in-polygon. ring은 닫혀있지 않아도 무방(첫점=끝점 강제 안 함). */
    private static boolean isInsideRing(double lon, double lat, List<double[]> ring) {
        boolean inside = false;
        int n = ring.size();
        for (int i = 0, j = n - 1; i < n; j = i++) {
            double xi = ring.get(i)[0], yi = ring.get(i)[1];
            double xj = ring.get(j)[0], yj = ring.get(j)[1];
            boolean intersects = ((yi > lat) != (yj > lat))
                    && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }
}
