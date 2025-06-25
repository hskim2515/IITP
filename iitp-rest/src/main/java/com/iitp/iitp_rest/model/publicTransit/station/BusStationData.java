package com.iitp.iitp_rest.model.publicTransit.station;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BusStationData {
    private String id;
    private String transitMode;
    private Integer linkRef;
    private Integer laneRef;
    private Double offset;
    private String type;
    private String address;
    private Double lat;
    private Double lng;
}
