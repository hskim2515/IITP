package com.iitp.iitp_rest.model.publicTransit.station;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

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
    private String type; // side, island, face-to-face, staggered
    private Integer parkingLots;
    private String address;
    private String center;
    private List<Coordinates> coordinates;

    @Data
    public static class Coordinates {
        private Double lat;
        private Double lng;
    }
}
