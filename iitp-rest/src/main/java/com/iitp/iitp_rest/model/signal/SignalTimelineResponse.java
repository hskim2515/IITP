package com.iitp.iitp_rest.model.signal;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
public class SignalTimelineResponse {

    private String nodeId;
    private List<Timeline> signalTimeline = new ArrayList<>();
    private List<Turn> turnInfo;

    @Data
    @NoArgsConstructor
    public static class Timeline {
        private String startTime;
        private String endTime;
        private List<String> activeTurns;
        private String signalState;
    }
    @Data
    public static class Turn {
        private String id;
        private String turning;
        private String type;
        private List<String> connList;
    }
}
