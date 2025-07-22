package com.iitp.iitp_rest.model.publicTransit.station;

import lombok.Data;

import java.util.List;

@Data
public class RailPublicTransitData {
    public List<RailStationData> railStations;
}
