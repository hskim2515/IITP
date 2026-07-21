package com.iitp.iitp_rest.model.passenger;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Passenger")
@XmlAccessorType(XmlAccessType.NONE)
public class PassengerXml {

    @XmlElement(name = "od_pax")
    private OdPaxXml odPax;

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class OdPaxXml {
        @XmlElement(name = "demand")
        private List<DemandXml> demands;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class DemandXml {
        @XmlAttribute
        private String origin;

        @XmlAttribute
        private String dest;

        @XmlAttribute
        private String dist;

        @XmlAttribute
        private Double flow;
    }
}
