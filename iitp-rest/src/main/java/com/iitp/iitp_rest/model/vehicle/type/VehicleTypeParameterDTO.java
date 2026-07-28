package com.iitp.iitp_rest.model.vehicle.type;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class VehicleTypeParameterDTO {
    private String vehicleId;
    private String name;
    private String v2x;
    private String drt;
    private String maxPax;
    private String nextsimTypeCode;

    private Long parameterId;
    private String parameterName;
    private String mean;
    private String sd;
    private String min;
    private String max;
    private String dist;

}


