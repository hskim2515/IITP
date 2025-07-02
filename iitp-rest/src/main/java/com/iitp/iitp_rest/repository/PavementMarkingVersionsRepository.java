package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PavementMarkingVersionsRepository extends JpaRepository<PavementMarkingVersion, Long> {

//    @Query("SELECT p.feature FROM PavementMarkingUpdate p WHERE p.versionId = :versionId")
//    List<String> findFeaturesByVersionId(@Param("versionId") Long versionId);

    Optional<PavementMarkingVersion> findByVersionId(String versionId);

}

