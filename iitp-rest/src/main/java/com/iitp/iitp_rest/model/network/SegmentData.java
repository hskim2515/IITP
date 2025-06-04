package com.iitp.iitp_rest.model.network;

import lombok.Data;

@Data
public class SegmentData {
    public String id;
    public boolean block;
    public double initPoint;
    public double endPoint;
    public String rightLc;
    public String leftLc;
}

