package com.iitp.iitp_rest.model.analytics;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * bbox + 시간창 내 레인별 교통량 집계 — LinkTrafficResponse의 레인 단위 버전.
 *
 * <p>메조 링크 레인/커넥션 색칠 전용(마이크로는 개별 차량 CZML로 이미 표시됨). 좌표는 담지 않는다
 * — 프론트가 이미 network.currentJsonData로 레인 지오메트리(offset 계산)를 갖고 있어
 * LinkTrafficResponse(타일 모드 대응용 좌표 동봉)와 달리 필요 없다.
 */
@Data
@NoArgsConstructor
public class LaneTrafficResponse {
    private int fromTime;
    private int toTime;
    private List<LaneTraffic> lanes = new ArrayList<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class LaneTraffic {
        private String linkId;
        private int laneId;
        private int volume;
        private double avgSpeed;

        /** 혼잡도/LOS 계산용 — AnalyticsController가 채움. 링크 capacity(qmax) ÷ 레인 수로 근사. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Double capacity;
        private double vcRatio;
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String losGrade;

        public LaneTraffic(String linkId, int laneId, int volume, double avgSpeed) {
            this.linkId = linkId;
            this.laneId = laneId;
            this.volume = volume;
            this.avgSpeed = avgSpeed;
        }
    }
}
