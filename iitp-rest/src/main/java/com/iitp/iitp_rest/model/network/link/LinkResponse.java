package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.lane.LaneResponse;
import com.iitp.iitp_rest.model.network.section.SectionResponse;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
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
    /** 도로명 (원본 ROAD_NAME 유래, 옵셔널) */
    private String name;
    private String layer;
    private double stopLine;
    private String shape;
    private List<LaneResponse> lanes = new ArrayList<>();
    private List<SectionResponse> sections = new ArrayList<>();
    private List<Coordinates> coordinates = new ArrayList<>();
}

