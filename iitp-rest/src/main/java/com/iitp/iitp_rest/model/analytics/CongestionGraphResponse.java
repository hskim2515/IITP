package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 혼잡 전파(인접 정체 링크 연결) 그래프 — "지식그래프 느낌"의 노드+엣지 시각화용.
 *
 * <p>⚠️ 실제 HCM 충격파(shockwave) 해석이 아니라 "V/C가 임계값 이상인 링크들 중 네트워크
 * 커넥션(회전)으로 직접 이어진 쌍을 연결"하는 근사다 — 정체 corridor를 보여주는 용도.
 */
@Data
@NoArgsConstructor
public class CongestionGraphResponse {
    private List<Node> nodes = new ArrayList<>();
    private List<Edge> edges = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Node {
        private String linkId;
        private double[] centroid;
        private double vcRatio;
        private String losGrade;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Edge {
        private String from;
        private String to;
    }
}
