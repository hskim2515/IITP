package com.iitp.iitp_rest.model.publicTransit.bus;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import lombok.Data;

@Data
public class BusStationResponse {
    private String id;

    private TransitMode transitMode;

    private Integer linkRef;

    private Integer laneRef;

    private Double pos;

    private StationType type;

    private Integer parkingLots;

    private String address;

    private String center;

    private BusLineResponse line;

    private Coordinates coordinates;
}
