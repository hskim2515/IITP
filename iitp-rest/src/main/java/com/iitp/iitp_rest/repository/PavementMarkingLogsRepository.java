package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;

public interface PavementMarkingLogsRepository extends JpaRepository<PavementMarkingLogs, Long> {

    @Modifying
    @Transactional
    List<PavementMarkingLogs> findByVersionId(String versionId);
    List<PavementMarkingLogs> findByVersionIdOrderByCreatedAtAsc(String versionId);
    void deleteByVersionId(String versionId);
}

