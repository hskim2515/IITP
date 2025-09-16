package com.iitp.iitp_rest.model.publicTransit.bus;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
public class BusStationData {
    private String id;
    private String transitMode;
    private Integer linkRef;
    private Integer laneRef;
    private Double pos;
    private String type; // side, island, face-to-face, staggered
    private Integer parkingLots;
    private String address;
    private String center;
    private List<String> lines;
    private List<Coordinates> coordinates = new ArrayList<>();

}
