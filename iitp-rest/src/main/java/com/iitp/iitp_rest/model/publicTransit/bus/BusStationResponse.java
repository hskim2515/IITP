package com.iitp.iitp_rest.model.publicTransit.bus;

import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import lombok.Data;

@Data
public class BusStationResponse {
    private String id;

    private TransitMode transitMode;

    private Long linkRef;

    private Long laneRef;

    private Double offset;

    private StationType type;

    private Integer parkingLots;

    private String address;

    private String center;

    private BusLineResponse line;
}
