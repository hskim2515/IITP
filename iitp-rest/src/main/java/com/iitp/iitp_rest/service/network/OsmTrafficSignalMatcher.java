package com.iitp.iitp_rest.service.network;

import java.util.*;

/**
 * {@link OsmTrafficSignalRepository#loadAll()}로 미리 로드한 전국 신호등 목록을 그리드로
 * 인덱싱해, 노드 좌표 하나하나마다 근처(40m 이내)에 실제 OSM 신호등이 있는지 빠르게 판정한다.
 * OsmTurnRestrictionMatcher와 동일한 그리드 인덱싱 패턴.
 */
public class OsmTrafficSignalMatcher {

    private static final double GRID_CELL_DEG = 0.001; // 대략 100m
    private static final double MATCH_DIST_M = 40.0;

    private final Map<Long, List<OsmTrafficSignalRepository.Signal>> grid = new HashMap<>();

    public OsmTrafficSignalMatcher(List<OsmTrafficSignalRepository.Signal> signals) {
        for (var s : signals) {
            grid.computeIfAbsent(cellKey(s.lat(), s.lon()), k -> new ArrayList<>()).add(s);
        }
    }

    private static long cellKey(double lat, double lon) {
        int gx = (int) Math.floor(lon / GRID_CELL_DEG);
        int gy = (int) Math.floor(lat / GRID_CELL_DEG);
        return (((long) gx) << 32) ^ (gy & 0xFFFFFFFFL);
    }

    /** 주어진 좌표 40m 이내에 실제 OSM 신호등이 있으면 true. */
    public boolean hasSignalNear(double lat, double lon) {
        int gx = (int) Math.floor(lon / GRID_CELL_DEG);
        int gy = (int) Math.floor(lat / GRID_CELL_DEG);
        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                List<OsmTrafficSignalRepository.Signal> candidates =
                        grid.get((((long) (gx + dx)) << 32) ^ ((gy + dy) & 0xFFFFFFFFL));
                if (candidates == null) continue;
                for (var s : candidates) {
                    if (OsmTurnRestrictionImporter.haversineM(lat, lon, s.lat(), s.lon()) <= MATCH_DIST_M) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
