package com.iitp.iitp_rest.model.analytics;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.iitp.iitp_rest.model.geometry.Coordinates;
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
        private double avgSpeed; // 평균 속도 (km/h) — 현재 운영 스키마(VehicleEvent)엔 spd 컬럼이 없어 항상 0

        /** 링크 중심선 좌표 (네트워크 타일 모드에서 클라이언트가 링크 지오메트리를 별도 보유하지 않으므로 동봉) */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private List<Coordinates> coordinates;

        /** 혼잡도/LOS 계산용 — AnalyticsController가 네트워크 조회 시 채움 */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Long fromNode;
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Long toNode;
        /** 링크 시간당 용량 (veh/h, LinkResponse.qmax 그대로) */
        private double capacity;
        /** 시간당 환산 volume / capacity. 계산 불가(capacity<=0 또는 windowSeconds<=0) 시 -1 */
        private double vcRatio;
        /** vcRatio 기반 단순 근사 등급 "A".."F" — 실제 HCM 교차로 제어지체 모델 아님. vcRatio<0 이면 null */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String losGrade;

        public LinkTraffic(String linkId, int volume, double avgSpeed) {
            this.linkId = linkId;
            this.volume = volume;
            this.avgSpeed = avgSpeed;
        }
    }
}
