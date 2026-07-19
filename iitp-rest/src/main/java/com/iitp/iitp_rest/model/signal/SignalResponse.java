package com.iitp.iitp_rest.model.signal;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class SignalResponse {
    private String nodeId;
    private String turnId;
    private String turning;
    private String type;
    //private List<String> connList = new ArrayList<>();
    private String connectionId;
    // 신호 타이밍 계획 (planList). 노드당 하나의 레코드에만 채워짐.
    private List<PlanData> plans;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class PlanData {
        private String id;
        private String cycle;
        private String offset;
        private List<PhaseData> phases;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class PhaseData {
        private String id;
        private String duration;
        private String turnList;
    }
}

