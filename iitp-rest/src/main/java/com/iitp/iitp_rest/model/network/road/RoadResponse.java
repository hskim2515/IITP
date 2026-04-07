package com.iitp.iitp_rest.model.network.road;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iitp.iitp_rest.model.geometry.Polyline;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoadResponse {
    private List<Road> roads;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Road {
        private String linkId;
        private String laneId;
        private Polyline polyline;

        private Double baseEasting;
        private Double baseNorthing;

        private Double targetEasting;
        private Double targetNorthing;

        private Double halfWidth;
        private int numLane;

        /** non-straight connection의 bezier 곡선 좌표 (로컬 좌표, double[]{x,y}). null이면 toAbsolute 사용 */
        @JsonIgnore
        private List<double[]> laneShape;

    }

}
