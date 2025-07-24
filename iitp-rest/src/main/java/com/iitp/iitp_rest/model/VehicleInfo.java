package com.iitp.iitp_rest.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class VehicleInfo {
    private int id;
    private String type;
    private String origin;
    private String destination;
    private double length;
    private double width;
    private double maxSpeed;
    private double maxAcc;
    private double maxDec;
    private double jamGap;
    private double reactionTime;

}
