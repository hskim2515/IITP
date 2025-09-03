package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class LinkResponse {
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
    @XmlTransient
    private List<Coordinates> coordinates;
    @XmlElement(name = "lane")
    private List<LaneResponse> lanes = new ArrayList<>();
}

