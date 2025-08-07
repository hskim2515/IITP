package com.iitp.iitp_rest.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class VehicleEvent {
    private String id;
    private String type;
    private Double timestep;
    private String linkId;
    private String laneId;
    private float posX;
    private float posY;
    private float speed;
    private float acc;
    private String spacing;
    private String driveMode;
    private String leaderId;
    private String targetlaneId;

    // Getters & Setters ...
}

