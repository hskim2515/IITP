package com.iitp.iitp_rest.model.publicTransit.bus;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.StationTypeAdapter;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import com.iitp.iitp_rest.model.publicTransit.TransitModeAdapter;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class BusStationXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    @XmlJavaTypeAdapter(TransitModeAdapter.class)
    private TransitMode transitMode = TransitMode.bus;
    @XmlAttribute(name = "link_ref")
    private Long linkRef;
    @XmlAttribute(name = "lane_ref")
    private String laneRef;
    @XmlAttribute(name = "pos")
    private Double offset;
    @XmlAttribute
    @XmlJavaTypeAdapter(StationTypeAdapter.class)
    private StationType type;
    @XmlAttribute
    private String parkingLots;
    @XmlAttribute
    private String center;
    @XmlElement(name = "line")
    @JsonIgnore
    private BusLineXml line;

    @XmlTransient
    private Coordinates coordinates;
}
