package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.signal.SignalResponse;

import java.util.List;
import java.util.Map;

public record OsmSaveResponse(
        NetworkResponse network,
        List<String> warnings,
        List<String> errors,
        List<SignalResponse> signals,
        PublicTransitResponse busStations,
        RailPublicTransitResponse railStations,
        Map<String, Object> busRoutes,
        Map<String, Object> railRoutes
) {
    /** 기존 호출부 호환: 경고만 */
    public OsmSaveResponse(NetworkResponse network, List<String> warnings) {
        this(network, warnings, List.of(), List.of(), null, null, null, null);
    }

    /** 에러 포함 */
    public OsmSaveResponse(NetworkResponse network, List<String> warnings, List<String> errors) {
        this(network, warnings, errors, List.of(), null, null, null, null);
    }
}
