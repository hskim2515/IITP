package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.publicTransit.bus.BusStationLogs;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;

public interface BusStationLogsRepository extends JpaRepository<BusStationLogs, Long> {

    @Modifying
    @Transactional
    List<BusStationLogs> findByVersionId(String versionId);
    List<BusStationLogs> findByVersionIdOrderByCreatedAtAsc(String versionId);
    void deleteByVersionId(String versionId);
}

