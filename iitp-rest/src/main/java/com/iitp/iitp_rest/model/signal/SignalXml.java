package com.iitp.iitp_rest.model.signal;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
@XmlRootElement(name = "Signal")
public class SignalXml {
    @XmlAttribute
    private Long id;

    @XmlElement(name = "node")
    private List<SignalNodeXml> node;


    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class SignalNodeXml {
        @XmlAttribute
        private Long id;

        @XmlElementWrapper(name = "turnList")
        @XmlElement(name = "turn")
        private List<TurnListXml> turns;
        @XmlElementWrapper(name = "planList")
        @XmlElement(name = "plan")
        private List<PlanListXml> plans;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class TurnListXml {
        @XmlAttribute
        private String id;
        @XmlAttribute
        private String turning;
        @XmlAttribute
        private String type;
        @XmlAttribute
        private String connList;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class PlanListXml {
        @XmlAttribute
        private String id;
        @XmlAttribute
        private String cycle;
        @XmlAttribute
        private String offset;
        @XmlElement(name = "phase")
        private List<PhaseXml> phase;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class PhaseXml {
        @XmlAttribute
        private String id;
        @XmlAttribute
        private String duration;
        @XmlAttribute
        private String turnList;
    }
}
