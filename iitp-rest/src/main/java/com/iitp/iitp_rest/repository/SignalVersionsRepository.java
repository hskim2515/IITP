package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.signal.SignalVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SignalVersionsRepository extends JpaRepository<SignalVersion, Long> {

    Optional<SignalVersion> findByVersionIdAndVersionRole(String versionId, BaseVersion.VersionRole versionRole);


}

