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

    // roadStation.xml 의 <Garages>, <Drt_Stations> 등 추가 요소 — 파싱 시 무시
    @XmlAnyElement(lax = true)
    private List<Object> others;
}
