package com.iitp.iitp_rest.model.network.lane;

import com.iitp.iitp_rest.model.network.cell.CellResponse;
import com.iitp.iitp_rest.model.network.cell.CellTreeResponse;
import com.iitp.iitp_rest.model.network.segment.SegmentResponse;
import com.iitp.iitp_rest.model.network.segment.SegmentTreeResponse;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
public class LaneTreeResponse {
    private Long linkId;
    private Long laneId;
    private List<CellTreeResponse> cells = new ArrayList<>();
    private List<SegmentTreeResponse> segments = new ArrayList<>();
    private Long id;
    private String leftLaneId;
    private String rightLaneId;
    private int numCell;
    private String laneAccessType;
    private Boolean rightLC;
    private Boolean leftLC;
    private String shape;

    public LaneTreeResponse(Long linkId, Long laneId, Long id, String leftLaneId, String rightLaneId, int numCell, String laneAccessType, Boolean rightLC, Boolean leftLC, String shape) {
        this.linkId = linkId;
        this.laneId = laneId;
        this.id = id;
        this.leftLaneId = leftLaneId;
        this.rightLaneId = rightLaneId;
        this.numCell = numCell;
        this.laneAccessType = laneAccessType;
        this.rightLC = rightLC;
        this.leftLC = leftLC;
        this.shape = shape;
    }

    public void addCell(CellTreeResponse cell) {
        this.cells.add(cell);
    }

    public void addSegment(SegmentTreeResponse segment) {
        this.segments.add(segment);
    }
}

