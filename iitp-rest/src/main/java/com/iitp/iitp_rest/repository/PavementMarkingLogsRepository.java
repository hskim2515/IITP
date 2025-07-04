package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import com.iitp.iitp_rest.model.pavementMarking.UpdateLog;
import com.iitp.iitp_rest.model.vehicle.VehicleType;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface PavementMarkingLogsRepository extends JpaRepository<PavementMarkingLogs, Long> {
    //void deleteByVersionId(String versionId);

    @Modifying
    @Transactional
    @Query("DELETE FROM PavementMarkingLogs p WHERE p.versionId = :versionId")
    void deleteByVersionId(@Param("versionId") String versionId);

    List<PavementMarkingLogs> findByVersionId(String versionId);
}

