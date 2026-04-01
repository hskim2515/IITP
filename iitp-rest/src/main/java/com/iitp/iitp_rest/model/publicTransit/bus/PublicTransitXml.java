package com.iitp.iitp_rest.model.publicTransit.bus;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "stations")
@XmlAccessorType(XmlAccessType.FIELD)
public class PublicTransitXml {
    @XmlElement(name = "station")
    private List<BusStationXml> busStations;
}
