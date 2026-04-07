package com.iitp.iitp_rest.model.signal;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "TOD")
@XmlAccessorType(XmlAccessType.NONE)
public class SignalTodXml {

    @XmlAttribute
    private Integer id;

    @XmlElement(name = "node")
    private List<NodeXml> nodes;

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class NodeXml {
        @XmlAttribute
        private String id;

        @XmlElement(name = "plan")
        private List<PlanXml> plans;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class PlanXml {
        @XmlAttribute
        private Integer id;
        @XmlAttribute
        private String startTime;
        @XmlAttribute
        private String endTime;
    }
}
