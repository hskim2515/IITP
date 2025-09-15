package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.signal.SignalLogs;
import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;

public interface SignalLogsRepository extends JpaRepository<SignalLogs, Long> {

    @Modifying
    @Transactional
    List<SignalLogs> findByVersionId(String versionId);
    List<SignalLogs> findByVersionIdOrderByCreatedAtAsc(String versionId);
    void deleteByVersionId(String versionId);
}

