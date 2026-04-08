package com.iitp.iitp_rest.repository;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ScenarioVersionRepository extends JpaRepository<ScenarioVersion, Long> {
    List<ScenarioVersion> findByScenarioId(Long scenarioId);
    Optional<ScenarioVersion> findByKey(String key);

    @Query("SELECT v FROM ScenarioVersion v JOIN FETCH v.scenario WHERE v.key = :key")
    Optional<ScenarioVersion> findByKeyWithScenario(@Param("key") String key);
}
