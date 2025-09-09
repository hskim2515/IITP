package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LinkResponse {
    private Long id;
    private Long fromNode;
    private Long toNode;
    private int numLane;
    private double length;
    private double width;
    private double maxSpd;
    private double minSpd;
    private double ffSpd;
    private double waveSpd;
    private double qmax;
    private double maxVeh;
    private SimType simType;
    private LinkType type;
    private String layer;
    private double stopLine;
    private String shape;
    private List<Coordinates> coordinates;
}

