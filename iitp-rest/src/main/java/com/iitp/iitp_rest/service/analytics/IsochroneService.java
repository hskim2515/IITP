package com.iitp.iitp_rest.service.analytics;

import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * 등시선(isochrone) 접근성 — 원점 노드에서 방향성 링크(fromNode→toNode, KTDB 관례상 도로는
 * 편도별 링크라 실제 일방통행을 그대로 반영)를 따라가는 Dijkstra 최단시간 탐색.
 *
 * <p>가중치(통행시간)는 실측 avgSpeed(현재 스키마에서 항상 0 — 신뢰 불가, 이번 세션 내내 확인한
 * 제약)가 아니라 자유흐름속도(ffSpd, 링크 정적 속성)에 V/C 기반 BPR류 감속 함수를 적용한
 * 근사다 — 실제 교통배정/HCM 모델이 아니라는 점을 호출측 UI에 명시해야 한다.
 */
@Service
public class IsochroneService {

    /** BPR 함수 계수(표준값 α=0.15, β=4) — vcRatio<0(계산 불가)이면 감속 없음(ffSpd 그대로) */
    private static final double BPR_ALPHA = 0.15;
    private static final double BPR_BETA = 4.0;
    /** 속도 0 나눗셈 방지용 최저 속도(km/h) */
    private static final double MIN_SPEED_KMH = 5.0;

    /**
     * @param net              그래프(NetworkResponse.getLinks(), Lod.NEAR 이상으로 조회된 것)
     * @param originNodeId     원점 노드 id
     * @param maxMinutes       탐색 상한(분)
     * @param vcRatioByLinkId  링크id(String) → V/C ratio. 없으면 -1(감속 없음)으로 취급
     * @return 도달한 노드id → 도달시각(초). cutoff 초과 노드는 미포함(원점 자신은 0.0)
     */
    public Map<Long, Double> computeArrivalSeconds(NetworkResponse net, long originNodeId, double maxMinutes,
                                                     Map<String, Double> vcRatioByLinkId) {
        return computeArrivalSeconds(buildAdjacency(net), originNodeId, maxMinutes, vcRatioByLinkId);
    }

    /**
     * 여러 원점(시설) 각각에서 도달권역을 구해, 링크별 "도달 가능한 원점 수"를 누적한다 —
     * 시설 서비스권 커버리지("영향권") 분석용. 그래프 인접리스트는 한 번만 빌드해 재사용한다.
     *
     * @return 링크id(String) → coverageCount(그 링크의 fromNode에 도달 가능한 원점 수)
     */
    public Map<String, Integer> computeCoverage(NetworkResponse net, List<Long> originNodeIds, double maxMinutes,
                                                  Map<String, Double> vcRatioByLinkId) {
        Map<Long, List<LinkResponse>> byFromNode = buildAdjacency(net);
        Map<String, Integer> coverage = new HashMap<>();
        for (Long origin : originNodeIds) {
            if (origin == null) continue;
            Map<Long, Double> arrival = computeArrivalSeconds(byFromNode, origin, maxMinutes, vcRatioByLinkId);
            for (LinkResponse l : net.getLinks()) {
                if (l.getFromNode() == null || l.getId() == null) continue;
                if (arrival.containsKey(l.getFromNode())) {
                    coverage.merge(String.valueOf(l.getId()), 1, Integer::sum);
                }
            }
        }
        return coverage;
    }

    private Map<Long, List<LinkResponse>> buildAdjacency(NetworkResponse net) {
        Map<Long, List<LinkResponse>> byFromNode = new HashMap<>();
        for (LinkResponse l : net.getLinks()) {
            if (l.getFromNode() == null || l.getToNode() == null) continue;
            byFromNode.computeIfAbsent(l.getFromNode(), k -> new ArrayList<>()).add(l);
        }
        return byFromNode;
    }

    private Map<Long, Double> computeArrivalSeconds(Map<Long, List<LinkResponse>> byFromNode, long originNodeId,
                                                      double maxMinutes, Map<String, Double> vcRatioByLinkId) {
        double cutoffSec = maxMinutes * 60.0;

        Map<Long, Double> dist = new HashMap<>();
        PriorityQueue<double[]> pq = new PriorityQueue<>(Comparator.comparingDouble(a -> a[1]));
        dist.put(originNodeId, 0.0);
        pq.add(new double[]{originNodeId, 0.0});

        while (!pq.isEmpty()) {
            double[] cur = pq.poll();
            long nodeId = (long) cur[0];
            double d = cur[1];
            if (d > dist.getOrDefault(nodeId, Double.MAX_VALUE)) continue; // 이미 더 짧은 경로로 확정됨(stale 항목)
            if (d > cutoffSec) continue;

            for (LinkResponse link : byFromNode.getOrDefault(nodeId, List.of())) {
                double vc = vcRatioByLinkId.getOrDefault(String.valueOf(link.getId()), -1.0);
                double weight = travelTimeSec(link, vc);
                double nd = d + weight;
                if (nd > cutoffSec) continue;
                Long toNode = link.getToNode();
                if (nd < dist.getOrDefault(toNode, Double.MAX_VALUE)) {
                    dist.put(toNode, nd);
                    pq.add(new double[]{toNode, nd});
                }
            }
        }
        return dist;
    }

    private double effectiveSpeedKmh(double ffSpdKmh, double vcRatio) {
        double speed = vcRatio >= 0
                ? ffSpdKmh / (1 + BPR_ALPHA * Math.pow(vcRatio, BPR_BETA))
                : ffSpdKmh;
        return Math.max(MIN_SPEED_KMH, speed);
    }

    private double travelTimeSec(LinkResponse link, double vcRatio) {
        double speedKmh = effectiveSpeedKmh(link.getFfSpd(), vcRatio);
        double speedMs = speedKmh * 1000.0 / 3600.0;
        return link.getLength() / speedMs;
    }
}
