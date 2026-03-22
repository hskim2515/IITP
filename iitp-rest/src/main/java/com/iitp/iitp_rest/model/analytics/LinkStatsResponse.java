package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class LinkStatsResponse {
    private int interval;
    private List<TimeSlotStats> overallTimeSeries;
    private List<LinkSummary> topLinks;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class TimeSlotStats {
        private int time;       // 시뮬레이션 시작 기준 초(s)
        private int volume;     // 해당 구간 내 고유 차량 수
        private double avgSpeed; // 평균 속도 (km/h)
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class LinkSummary {
        private String linkId;
        private int totalVolume;
        private double avgSpeed;
        private List<TimeSlotStats> timeSeries;
    }
}
