package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * bbox + 시간창 내 링크별 교통량 집계 (차량 overview LOD — 멀리서 전체 교통량).
 *
 * <p>개별 차량 대신 "이 링크가 막히나"(volume/avgSpeed)만 내려 히트맵으로 표시.
 * 메모리에 개별 차량을 들지 않고 백엔드가 SQLite GROUP BY 로 집계한다.
 */
@Data
@NoArgsConstructor
public class LinkTrafficResponse {
    /** 집계 시간창 (초) — 0 이면 전체 */
    private int fromTime;
    private int toTime;
    private List<LinkTraffic> links = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class LinkTraffic {
        private String linkId;
        private int volume;     // 시간창 내 고유 차량 수
        private double avgSpeed; // 평균 속도 (km/h)
    }
}
