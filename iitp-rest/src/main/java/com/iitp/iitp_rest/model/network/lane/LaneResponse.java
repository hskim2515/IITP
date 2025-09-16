package com.iitp.iitp_rest.model.network.lane;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.cell.CellResponse;
import com.iitp.iitp_rest.model.network.segment.SegmentResponse;
import lombok.Data;

import java.util.ArrayList;
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
    private List<SegmentResponse> segments = new ArrayList<>();
    private List<CellResponse> cells = new ArrayList<>();
    private List<Coordinates> coordinates;
}

