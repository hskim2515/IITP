package com.iitp.iitp_rest.model.network.connection;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlTransient;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class ConnectionXmlResponse {
    @XmlAttribute
    private Long id;
    @XmlAttribute(name = "from_link")
    private Long fromLink;
    @XmlAttribute(name = "from_lane")
    private Long fromLane;
    @XmlAttribute(name = "to_link")
    private Long toLink;
    @XmlAttribute(name = "to_lane")
    private Long toLane;
    @XmlAttribute
    @XmlJavaTypeAdapter(TurningAdapter.class)
    private Turning turning;
    @XmlAttribute
    private double length;
    @XmlAttribute
    private double width;
    @XmlAttribute(name = "ff_spd")
    private double ffSpd;
    @XmlAttribute
    private String shape;

    @XmlTransient
    private Coordinates fromLaneCoordinates;
    @XmlTransient
    private Coordinates toLaneCoordinates;
    @XmlTransient
    private List<Coordinates> coordinates;
}
