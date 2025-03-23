package com.iitp.iitp_rest.model.request;

import com.iitp.iitp_rest.model.Road;
import lombok.Data;

import java.util.List;

@Data
public class VehicleRequest {
    private int numVehicle;
    private List<Road> roadEntities;
    private int speedFactor;
}
