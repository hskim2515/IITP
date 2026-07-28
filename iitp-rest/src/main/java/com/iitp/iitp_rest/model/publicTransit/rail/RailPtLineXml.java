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
        @XmlAttribute
        private String fee;
        /** 공백 구분 시각 목록(HH:mm), NextSim railPTLine.xml의 Line departureTime 속성과 동일 형식 */
        @XmlAttribute
        private String departureTime;
        /** railStationSeq와 병렬 대응하는 공백 구분 timeOffset(초) 목록 */
        @XmlAttribute
        private String timeOffsetSeq;
    }
}
