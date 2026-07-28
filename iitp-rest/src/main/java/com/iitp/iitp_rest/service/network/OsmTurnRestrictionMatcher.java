package com.iitp.iitp_rest.service.network;

import java.util.*;

/**
 * {@link OsmTurnRestrictionRepository#loadAll()}로 미리 로드한 회전제약 목록을 그리드로
 * 인덱싱해, connection 후보 하나하나(진입/진출 방위각)마다 가장 가까운 매칭 제약을 빠르게
 * 찾는다. KtdbNetworkConverter/KtdbStreamingConverter가 변환 1회당 이 매처를 한 번만 만들어
 * connection 후보 수만큼 {@link #findProhibition} 을 호출한다(변환마다 DB 왕복 없음 —
 * ktdb_turninfo를 통째로 미리 읽어 메모리에서 조회하는 기존 관례와 동일).
 */
public class OsmTurnRestrictionMatcher {

    private static final double GRID_CELL_DEG = 0.001; // 대략 100m
    private static final double VIA_MATCH_DIST_M = 40.0;
    private static final double MAX_TOTAL_ANGLE_DIFF_DEG = 30.0; // from+to 각도오차 합 임계값(자동 필터링이라 보수적으로)

    private final Map<Long, List<OsmTurnRestrictionRepository.Restriction>> grid = new HashMap<>();

    public OsmTurnRestrictionMatcher(List<OsmTurnRestrictionRepository.Restriction> restrictions) {
        for (var r : restrictions) {
            long key = cellKey(r.viaLat(), r.viaLon());
            grid.computeIfAbsent(key, k -> new ArrayList<>()).add(r);
        }
    }

    private static long cellKey(double lat, double lon) {
        int gx = (int) Math.floor(lon / GRID_CELL_DEG);
        int gy = (int) Math.floor(lat / GRID_CELL_DEG);
        return (((long) gx) << 32) ^ (gy & 0xFFFFFFFFL);
    }

    /**
     * @param nodeLat/nodeLon 교차로 노드 좌표
     * @param inBearing  이 connection 후보의 진입 링크가 이 노드로 들어오는 방향(도)
     * @param outBearing 이 connection 후보의 진출 링크가 이 노드에서 나가는 방향(도)
     * @return 이 회전을 금지하는 OSM 제약이 있으면 그 restriction 코드, 없으면 null
     */
    public String findProhibition(double nodeLat, double nodeLon, double inBearing, double outBearing) {
        int gx = (int) Math.floor(nodeLon / GRID_CELL_DEG);
        int gy = (int) Math.floor(nodeLat / GRID_CELL_DEG);

        String best = null;
        double bestScore = Double.MAX_VALUE;
        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                List<OsmTurnRestrictionRepository.Restriction> candidates =
                        grid.get((((long) (gx + dx)) << 32) ^ ((gy + dy) & 0xFFFFFFFFL));
                if (candidates == null) continue;
                for (var r : candidates) {
                    double dist = OsmTurnRestrictionImporter.haversineM(nodeLat, nodeLon, r.viaLat(), r.viaLon());
                    if (dist > VIA_MATCH_DIST_M) continue;
                    double score = OsmTurnRestrictionImporter.angleDiff(r.fromBearing(), inBearing)
                            + OsmTurnRestrictionImporter.angleDiff(r.toBearing(), outBearing);
                    if (score < bestScore) {
                        bestScore = score;
                        best = r.restriction();
                    }
                }
            }
        }
        return bestScore <= MAX_TOTAL_ANGLE_DIFF_DEG ? best : null;
    }
}
