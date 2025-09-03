package com.iitp.iitp_rest.model.publicTransit.station;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.Builder;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;


@Data
@Builder
public class ExitData {
    private String id;
    private int linkRef;
    private double offset;
    private double accessTime;
    private List<Coordinates> coordinates = new ArrayList<>();
    private String coord;

}