package com.iitp.iitp_rest.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class VehicleState {
    private String id;
//    private double lon;
//    private double lat;
//    private double height;
    private String displayType;

    private double timestep;
    private String linkId;
    private String laneId;
    private double posX;
    private double posY;

//    private String src;
//    private String sink;
//    private String newSink;
//    private double avgSpeed;
//    private double travelTime;
//    private double travelDistance;
//    private double delayTime;
//    private int travelCost;

//    private double speed;
//    private double acceleration;
//    private double spacing;
//    private String mode;
//    private String leaderId;
//    private double leaderSpeed;
//    private String targetLaneId;
//    private String simMode;
//    private String v2x;
//    private String v2xMsgType;
//    private double v2xValue;
//    private double arrivalTime;
//    private double departureTime;
//    private int financialCost;
}

