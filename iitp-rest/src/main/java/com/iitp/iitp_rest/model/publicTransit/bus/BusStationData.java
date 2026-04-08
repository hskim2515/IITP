package com.iitp.iitp_rest.model.publicTransit.bus;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class BusStationData {
    private String id;
    private String transitMode;
    private Long linkRef;
    private Long laneRef;
    private Double offset;
    private String type; // side, island, face-to-face, staggered
    private Integer parkingLots;
    private String address;
    private String center;
    private BusLineResponse line;
}
