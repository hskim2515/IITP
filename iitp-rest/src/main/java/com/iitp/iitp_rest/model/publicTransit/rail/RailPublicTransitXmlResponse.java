package com.iitp.iitp_rest.model.publicTransit.rail;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "RailPublicTransit")
@XmlAccessorType(XmlAccessType.FIELD)
public class RailPublicTransitXmlResponse {
    @XmlElementWrapper
    @XmlElement(name = "railStation")
    private List<RailStationXmlResponse> railStations;
}
