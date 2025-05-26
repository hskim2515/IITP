package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.vehicle.VehicleType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface VehicleTypeRepository extends JpaRepository<VehicleType, Long> {

    List<VehicleType> findAll();

}

