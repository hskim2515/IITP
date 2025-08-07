package com.iitp.iitp_rest.model.pavementMarking;

import com.iitp.iitp_rest.model.publicTransit.station.BusStationData;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PavementMarkingData {
    private String id;
    private Double angle;
    private Integer cellId;
    private Double offset;
    private Integer laneRef;
    private Integer linkRef;
    private String markingType;
    private List<Coordinates> coordinates;

    @Data
    public static class Coordinates {
        private Double lat;
        private Double lng;
    }

}
