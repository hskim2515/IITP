package com.iitp.iitp_rest.model.request;

import lombok.Data;

import java.util.List;

@Data
public class VehicleRouteRequest {
    private String versionId;
    private List<List<Double>> coordinates;
}
