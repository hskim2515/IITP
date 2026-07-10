package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.VehicleRoute;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface VehicleRouteRepository extends JpaRepository<VehicleRoute, String> {
    Optional<VehicleRoute> findByVersionId(String versionId);
    void deleteByVersionId(String versionId);
}

