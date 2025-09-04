package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.network.lane.LaneXmlResponse;
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class LinkXmlResponse {
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
    @XmlAttribute
    private String layer;
    @XmlAttribute(name = "stop_line")
    private double stopLine;
    @XmlAttribute
    private String shape;
    @XmlElement(name = "lane")
    private List<LaneXmlResponse> lanes = new ArrayList<>();
}

