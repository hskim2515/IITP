package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * bbox + 시간창 내 차량들의 origin/destination 흐름 집계 (차량 overview LOD 중 가장 축소된 단계).
 *
 * <p>각 차량의 시간창 내 첫/마지막 위치를 격자로 스냅해 (origin격자, destination격자) 쌍별로
 * 집계한다 — 개별 차량 좌표 대신 화살표 굵기(volume)로 흐름을 표시. 메모리에 개별 차량을
 * 들지 않고 백엔드가 SQLite GROUP BY로 집계한다(link-traffic과 동일한 이유).
 */
@Data
@NoArgsConstructor
public class OdFlowResponse {
    /** 집계 시간창 (초) — 0 이면 전체 */
    private int fromTime;
    private int toTime;
    private List<OdPair> pairs = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class OdPair {
        private double fromLng;
        private double fromLat;
        private double toLng;
        private double toLat;
        /** 이 격자쌍으로 집계된 차량 수 */
        private int volume;
    }
}
