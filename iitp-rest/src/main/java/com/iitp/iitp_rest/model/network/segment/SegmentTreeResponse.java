package com.iitp.iitp_rest.model.network.segment;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class SegmentTreeResponse {
    private Long laneId;
    private Long id;
    private Boolean block;
    private double initPoint;
    private double endPoint;

    public SegmentTreeResponse(Long laneId, Long id, Boolean block, double initPoint, double endPoint) {
        this.laneId = laneId;
        this.id = id;
        this.block = block;
        this.initPoint = initPoint;
        this.endPoint = endPoint;
    }
}

