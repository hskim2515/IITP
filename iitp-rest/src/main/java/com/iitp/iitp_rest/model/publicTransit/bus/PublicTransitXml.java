package com.iitp.iitp_rest.model.publicTransit.bus;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "PublicTransit")
@XmlAccessorType(XmlAccessType.FIELD)
public class PublicTransitXml {
    @XmlElementWrapper(name = "Stations")
    @XmlElement(name = "station")
    private List<BusStationXml> busStations;
}
