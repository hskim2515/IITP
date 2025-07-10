package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.publicTransit.station.BusStationVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface BusStationVersionsRepository extends JpaRepository<BusStationVersion, Long> {

//    @Query("SELECT p.feature FROM PavementMarkingUpdate p WHERE p.versionId = :versionId")
//    List<String> findFeaturesByVersionId(@Param("versionId") Long versionId);

    Optional<BusStationVersion> findByVersionId(String versionId);

}

