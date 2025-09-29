package com.iitp.iitp_rest.model.request;

import com.iitp.iitp_rest.model.network.road.RoadResponse;
import lombok.Data;

import java.util.List;

@Data
public class VehicleRequest {
    private int numVehicle;
    private List<RoadResponse.Road> roadEntities;
    private int speedFactor;
}
