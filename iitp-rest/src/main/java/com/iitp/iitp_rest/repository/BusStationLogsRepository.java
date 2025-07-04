package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationLogs;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface BusStationLogsRepository extends JpaRepository<BusStationLogs, Long> {
    //void deleteByVersionId(String versionId);

    @Modifying
    @Transactional
    @Query("DELETE FROM BusStationLogs p WHERE p.versionId = :versionId")
    void deleteByVersionId(@Param("versionId") String versionId);

    List<BusStationLogs> findByVersionId(String versionId);
}

