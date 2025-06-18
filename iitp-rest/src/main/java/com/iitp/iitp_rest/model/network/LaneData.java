package com.iitp.iitp_rest.model.network;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class LaneData {
    public String id;
    public int numCell;
    public String leftLaneId;
    public String rightLaneId;
    public String shape;

    public List<CellData> cells = new ArrayList<>();
    public List<SegmentData> segments = new ArrayList<>();
}

