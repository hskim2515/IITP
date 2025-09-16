package com.iitp.iitp_rest.model.network.lane;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.cell.CellXml;
import com.iitp.iitp_rest.model.network.segment.SegmentXml;
import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class LaneXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute(name = "left_lane_id")
    private String leftLaneId; // 인터페이스 정의서 매칭X int
    @XmlAttribute(name = "right_lane_id")
    private String rightLaneId;  // 인터페이스 정의서 매칭X int
    @XmlAttribute(name = "num_cell")
    private int numCell;
    @XmlAttribute(name = "lane_access_type")
    private String laneAccessType;
    @XmlAttribute(name = "right_lc")
    private boolean rightLC;
    @XmlAttribute(name = "left_lc")
    private boolean leftLC;
    @XmlAttribute
    private String shape;
    @XmlElement(name = "segment")
    private List<SegmentXml> segments = new ArrayList<>();
    @XmlElement(name = "cell")
    private List<CellXml> cells = new ArrayList<>();

    @XmlTransient
    private List<Coordinates> coordinates;
}

