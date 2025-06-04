package com.iitp.iitp_rest.model.network;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class LinkData {
    public String id;
    public String fromNode;
    public String toNode;
    public int numLane;
    public double length;
    public double width;
    public double minSpd;
    public double maxSpd;
    public double ffSpd;
    public double waveSpd;
    public double qmax;
    public double maxVeh;
    public int simType;
    public String type;
    public String layer;
    public double stopLine;
    public String shape;

    public List<LaneData> lanes = new ArrayList<>();
}

