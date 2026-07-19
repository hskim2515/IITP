package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.section.SectionXml;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class LinkXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute(name = "from_node")
    private Long fromNode;
    @XmlAttribute(name = "to_node")
    private Long toNode;
    @XmlAttribute(name = "num_lane")
    private int numLane;
    @XmlAttribute
    private double length;
    @XmlAttribute
    private double width;
    @XmlAttribute(name = "max_spd")
    private double maxSpd;
    @XmlAttribute(name = "min_spd")
    private double minSpd;
    @XmlAttribute(name = "ff_spd")
    private double ffSpd;
    @XmlAttribute(name = "wave_spd")
    private double waveSpd;
    @XmlAttribute
    private double qmax;
    @XmlAttribute(name = "max_veh")
    private double maxVeh;
    @XmlAttribute(name = "sim_type")
    @XmlJavaTypeAdapter(SimTypeAdapter.class)
    private SimType simType;
    @XmlAttribute
    @XmlJavaTypeAdapter(LinkTypeAdapter.class)
    private LinkType type;
    /** 도로명 (표준노드링크 ROAD_NAME 등 원본 유래, 옵셔널) */
    @XmlAttribute
    private String name;
    @XmlAttribute
    private String layer;
    @XmlAttribute(name = "stop_line")
    private double stopLine;
    @XmlAttribute
    private String shape;
    @XmlElement(name = "lane")
    private List<LaneXml> lanes = new ArrayList<>();

    @XmlElement(name = "section")
    private List<SectionXml> sections = new ArrayList<>();

    @XmlTransient
    private List<Coordinates> coordinates;
}

