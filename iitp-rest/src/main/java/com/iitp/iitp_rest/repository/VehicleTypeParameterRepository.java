package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.vehicle.type.VehicleType;
import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeParameter;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface VehicleTypeParameterRepository extends JpaRepository<VehicleTypeParameter, Long> {

    List<VehicleTypeParameter> findByVehicleType_Id(Long vehicleTypeId);

    @Modifying
    @Transactional
    @Query("DELETE FROM VehicleTypeParameter p WHERE p.vehicleType = :vehicleType")
    void deleteByVehicleType(@Param("vehicleType") VehicleType vehicleType);

    @Modifying
    @Query("DELETE FROM VehicleTypeParameter p WHERE p.vehicleType.id IN :vehicleTypeIds")
    void deleteByVehicleTypeIds(@Param("vehicleTypeIds") List<Long> vehicleTypeIds);
}

