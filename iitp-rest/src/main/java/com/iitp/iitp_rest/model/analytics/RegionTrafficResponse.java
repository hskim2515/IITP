package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 행정구역(시도/시군구/읍면동) 단위 교통량 집계 — 줌 레벨에 따라 tier를 바꿔 요청한다.
 * 링크의 volume/capacity를 소속 지역별로 합산해 vcRatio를 다시 계산한다.
 */
@Data
@NoArgsConstructor
public class RegionTrafficResponse {
    /** "sido" | "sigungu" | "eupmyeondong" */
    private String tier;
    private List<RegionTraffic> regions = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RegionTraffic {
        private String code;
        private String name;
        /** 지역 경계 — MultiPolygon 링 목록 ([lon,lat] 점 배열) */
        private List<List<double[]>> rings;
        /** 지역 중심점 [lon,lat] — 라벨/3D 컬럼 배치용 */
        private double[] centroid;
        /** 소속 링크 volume 합 (시간당 환산 전, readLinkTraffic 원 단위 그대로) */
        private int volume;
        /** 소속 링크 capacity(veh/h) 합 */
        private double capacity;
        /** 지역 volume(시간당 환산)/capacity 합. 계산 불가 시 -1 */
        private double vcRatio;
        /** 집계에 포함된 링크 수 */
        private int linkCount;
    }
}
