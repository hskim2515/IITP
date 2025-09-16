package com.iitp.iitp_rest.model.publicTransit.rail;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import lombok.Data;

import java.util.List;

@Data
public class RailStationResponse {
    private String id;
    private TransitMode transitMode;
    private String lineList;
    private StationType type;
    private String address;
    private String center;
    private List<ExitResponse> exits;
    private List<TimetableResponse> timetables;
    private Coordinates coordinates;

}
