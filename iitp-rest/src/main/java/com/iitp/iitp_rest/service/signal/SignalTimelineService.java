package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.SignalTimelineResponse;

import java.time.Instant;
import java.util.List;

public interface SignalTimelineService {
    List<SignalTimelineResponse> generateSignalTimeline(long simulationStartTime, String targetPlanId, String dataPath, int simulationDurationSeconds);
}