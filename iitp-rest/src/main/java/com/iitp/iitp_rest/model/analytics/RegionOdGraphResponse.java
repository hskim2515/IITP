package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 지역(시도/시군구/읍면동) 간 OD(출발-도착) 관계 그래프 — "지식그래프 느낌"의 노드+엣지 시각화용.
 * 차량 1대는 시간창 내 첫 위치(출발 지역)/마지막 위치(도착 지역) 각 1개만 가지므로 지역 집계에
 * 이중카운트가 없다(region-traffic의 volume 이중카운트 문제와 다름).
 */
@Data
@NoArgsConstructor
public class RegionOdGraphResponse {
    private String tier;
    private List<Node> nodes = new ArrayList<>();
    private List<Edge> edges = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Node {
        private String code;
        private String name;
        /** 그 지역이 출발/도착으로 관여한 실제 차량 위치 평균 [lng,lat] — 행정경계 전체 중심 아님 */
        private double[] centroid;
        /** 이 지역이 관여한(출발+도착) 전체 차량 수 */
        private int totalVolume;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Edge {
        private String from;
        private String to;
        private int volume;
    }
}
