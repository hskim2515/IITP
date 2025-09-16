package com.iitp.iitp_rest.model.publicTransit.rail;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.StationTypeAdapter;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import com.iitp.iitp_rest.model.publicTransit.TransitModeAdapter;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class RailStationXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    @XmlJavaTypeAdapter(TransitModeAdapter.class)
    private TransitMode transitMode = TransitMode.subway;
    @XmlAttribute
    private String lineList;
    @XmlAttribute
    @XmlJavaTypeAdapter(StationTypeAdapter.class)
    private StationType type;
    @XmlAttribute
    private String address;
    @XmlAttribute
    private String center;
    @XmlElement(name = "exit")
    private List<ExitXml> exits = new ArrayList<>();
    @XmlElement(name = "timetable")
    @JsonIgnore
    private List<TimetableXml> timetables = new ArrayList<>();
    @XmlTransient
    private Coordinates coordinates;
}
