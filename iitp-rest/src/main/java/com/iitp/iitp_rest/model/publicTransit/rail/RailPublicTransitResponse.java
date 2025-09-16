package com.iitp.iitp_rest.model.publicTransit.rail;

import lombok.Data;

import java.util.List;

@Data
public class RailPublicTransitResponse {
    private List<RailStationResponse> railStations;
}
