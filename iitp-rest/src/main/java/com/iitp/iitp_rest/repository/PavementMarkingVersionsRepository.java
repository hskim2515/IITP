package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PavementMarkingVersionsRepository extends JpaRepository<PavementMarkingVersion, Long> {

    Optional<PavementMarkingVersion> findByVersionId(String versionId);

    Optional<PavementMarkingVersion> findByVersionIdAndVersionRole(String versionId, BaseVersion.VersionRole versionRole);

}

