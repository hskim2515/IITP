package com.iitp.iitp_rest.model.publicTransit.station;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class ExitData {
    private String id;
    private int linkRef;
    private double offset;
    private double accessTime;
    private List<Coordinates> coordinates;
    private String coord;

    @Data
    public static class Coordinates {
        private Double lat;
        private Double lng;
    }
}