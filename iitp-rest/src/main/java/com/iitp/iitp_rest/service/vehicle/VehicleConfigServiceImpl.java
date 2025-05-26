package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.model.vehicle.VehicleType;
import com.iitp.iitp_rest.model.vehicle.VehicleTypeParameter;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
@RequiredArgsConstructor
public class VehicleConfigServiceImpl implements VehicleConfigService {

    @Override
    public List<VehicleType> getVehicleTypeList() {
        return List.of();
    }

    @Override
    public List<VehicleTypeParameter> getVehicleTypeParamerterList() {
        return List.of();
    }

    @Override
    public List<VehicleType> getVehicleModelList() {
        return List.of();
    }
}
