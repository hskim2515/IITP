package com.iitp.iitp_rest.model.network.segment;

import lombok.Data;

@Data
public class SegmentResponse {
    private Long id;
    private Boolean block = Boolean.FALSE;
    private double initPoint;
    private double endPoint;
    private String rightLc = "";
    private String leftLc = "";
}

