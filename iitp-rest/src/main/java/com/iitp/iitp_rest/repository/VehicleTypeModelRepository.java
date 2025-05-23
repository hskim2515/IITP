package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.vehicle.VehicleType;
import com.iitp.iitp_rest.model.vehicle.VehicleTypeModel;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface VehicleTypeModelRepository extends JpaRepository<VehicleTypeModel, Long> {

    List<VehicleTypeModel> findAll();

}

