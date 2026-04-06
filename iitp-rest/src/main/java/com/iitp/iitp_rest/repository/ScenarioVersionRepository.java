package com.iitp.iitp_rest.repository;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ScenarioVersionRepository extends JpaRepository<ScenarioVersion, Long> {
    List<ScenarioVersion> findByScenarioId(Long scenarioId);
    Optional<ScenarioVersion> findByKey(String key);
}
