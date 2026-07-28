package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * bbox 내 신호교차로별 서비스수준(LOS) 근사 — 접근 링크(해당 노드로 향하는 링크)들의
 * V/C 기반 losGrade 중 최악값을 그 교차로의 등급으로 채택한다.
 *
 * <p>⚠️ 실제 HCM 교차로 제어지체(신호주기/현시) 계산이 아니라 접근로 V/C 최악값 근사 —
 * 데모/보고서 시각화 용도.
 */
@Data
@NoArgsConstructor
public class IntersectionLosResponse {
    private List<IntersectionLos> intersections = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class IntersectionLos {
        private String nodeId;
        private Double lng;
        private Double lat;
        /** 접근 링크들의 losGrade 중 최악(A가 가장 좋음, F가 가장 나쁨) */
        private String losGrade;
        /** 등급 계산에 사용된 접근 링크 수 */
        private int approachLinkCount;
    }
}
