package com.iitp.iitp_rest.model.network.lane;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.Data;

import java.util.List;

@Data
public class LaneResponse {
    private Long id;
    private String leftLaneId; // 인터페이스 정의서 매칭X int
    private String rightLaneId;  // 인터페이스 정의서 매칭X int
    private int numCell;
    private String laneAccessType;
    private boolean rightLC;
    private boolean leftLC;
    private String shape;
    private List<Coordinates> coordinates;
}

