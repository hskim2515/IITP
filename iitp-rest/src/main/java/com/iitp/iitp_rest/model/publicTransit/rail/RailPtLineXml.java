package com.iitp.iitp_rest.model.publicTransit.rail;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Mode")
@XmlAccessorType(XmlAccessType.NONE)
public class RailPtLineXml {

    @XmlAttribute
    private String type;

    @XmlElementWrapper(name = "routes")
    @XmlElement(name = "route")
    private List<RouteXml> routes;

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class RouteXml {
        @XmlAttribute
        private Integer id;
        @XmlAttribute
        private String name;
        @XmlAttribute
        private String railStationSeq;
    }
}
