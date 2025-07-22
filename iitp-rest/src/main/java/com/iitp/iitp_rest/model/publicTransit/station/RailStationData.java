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
public class RailStationData {
    private String id;
    private String transitMode;
    private String address;
    private List<ExitData> exits;

    private List<Coordinates> coordinates;

    @Data
    public static class Coordinates {
        private Double lat;
        private Double lng;
    }
}
