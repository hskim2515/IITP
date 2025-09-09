package com.iitp.iitp_rest.model.publicTransit.bus;

import lombok.Data;

import java.util.List;

@Data
public class PublicTransitData {
    private List<BusStationData> busStations;
}
