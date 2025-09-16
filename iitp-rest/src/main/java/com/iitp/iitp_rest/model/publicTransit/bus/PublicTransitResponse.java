package com.iitp.iitp_rest.model.publicTransit.bus;

import lombok.Data;

import java.util.List;

@Data
public class PublicTransitResponse {
    private List<BusStationResponse> busStations;
}
