package com.iitp.iitp_rest.model.analytics;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 시설(버스정류장/철도역) 서비스권 커버리지("영향권") 분석 — 뷰포트 내 모든 대상 시설 각각에서
 * maxMinutes 안에 도달 가능한 링크를 계산해, 링크별로 "몇 개 시설에서 도달 가능한가
 * (coverageCount)"를 누적한다. 여러 시설의 서비스권이 겹치는 곳(잘 커버됨)과 어느 시설에서도
 * 안 닿는 곳(사각지대, coverageCount=0 — 응답엔 아예 없음)을 구분해 보여주는 용도.
 *
 * <p>⚠️ 실제 교통배정/HCM 모델이 아니라 자유흐름속도+V/C 근사(IsochroneService) 기반 추정.
 */
@Data
@NoArgsConstructor
public class FacilityCoverageResponse {
    private double maxMinutes;
    private int facilityCount;
    private List<Facility> facilities = new ArrayList<>();
    private List<CoveredLink> links = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Facility {
        /** "bus" | "rail" */
        private String type;
        private double lng;
        private double lat;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class CoveredLink {
        private String linkId;
        private List<Coordinates> coordinates;
        /** 이 링크(fromNode)에 도달 가능한 시설 수 (최소 1 — 0인 링크는 응답에서 제외) */
        private int coverageCount;
    }
}
