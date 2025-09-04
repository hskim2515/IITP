package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.network.lane.LaneTreeResponse;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
public class LinkTreeResponse {
    private Long id;
    private List<LaneTreeResponse> lanes = new ArrayList<>();

    private Long fromNode;
    private Long toNode;
    private int numLane;
    private double length;
    private double width;
    private double minSpd;
    private double maxSpd;
    private double ffSpd;
    private double waveSpd;
    private double qmax;
    private double maxVeh;
    private SimType simType;
    private LinkType type;
    private String layer;
    private double stopLine;
    private String shape;

    public void addLane(LaneTreeResponse lane) {
        this.lanes.add(lane);
    }

    public LinkTreeResponse(Long id, Long fromNode, Long toNode, int numLane, double length, double width, double maxSpd, double ffSpd, double minSpd, double waveSpd, double qmax, double maxVeh, SimType simType, String layer, LinkType type, double stopLine, String shape) {
        this.id = id;
        this.fromNode = fromNode;
        this.toNode = toNode;
        this.numLane = numLane;
        this.length = length;
        this.width = width;
        this.maxSpd = maxSpd;
        this.ffSpd = ffSpd;
        this.minSpd = minSpd;
        this.waveSpd = waveSpd;
        this.qmax = qmax;
        this.maxVeh = maxVeh;
        this.simType = simType;
        this.layer = layer;
        this.type = type;
        this.stopLine = stopLine;
        this.shape = shape;
    }
}

