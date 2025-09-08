package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;

public interface RailStationLogsRepository extends JpaRepository<RailStationLogs, Long> {

    @Modifying
    @Transactional
    List<RailStationLogs> findByVersionId(String versionId);
    List<RailStationLogs> findByVersionIdOrderByCreatedAtAsc(String versionId);
}

