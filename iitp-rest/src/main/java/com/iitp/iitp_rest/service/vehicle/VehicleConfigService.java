package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.model.vehicle.type.VehicleType;
import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeParameter;

import java.util.List;

public interface VehicleConfigService {

    public List<VehicleType> getVehicleTypeList();

    public List<VehicleTypeParameter> getVehicleTypeParamerterList();

    public List<VehicleType> getVehicleModelList();
}
