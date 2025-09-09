package com.iitp.iitp_rest.model.vehicle.route;

import com.iitp.iitp_rest.model.network.RoadResponse;
import lombok.Data;


@Data
public class VehicleRequest {
    private int numVehicle;
    private RoadResponse roadEntities;
    private int speedFactor;
}
