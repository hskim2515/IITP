package com.iitp.iitp_rest.model.scenario;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Scenarios")
@XmlAccessorType(XmlAccessType.NONE)
public class SimulationRunXml {

    @XmlElement(name = "Scenario")
    private List<ScenarioItemXml> scenarios;

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class ScenarioItemXml {
        @XmlAttribute
        private Integer id;
        @XmlAttribute
        private String startTime;
        @XmlAttribute
        private Integer duration;
        @XmlAttribute(name = "BGTduration")
        private Integer bgtDuration;
        @XmlAttribute
        private Integer odMatrixID;
        @XmlAttribute
        private Integer todID;
    }
}
