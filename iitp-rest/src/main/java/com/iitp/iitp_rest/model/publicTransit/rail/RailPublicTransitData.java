package com.iitp.iitp_rest.model.publicTransit.rail;

import lombok.Data;

import java.util.List;

@Data
public class RailPublicTransitData {
    private List<RailStationData> railStations;
}
