package com.iitp.iitp_rest.repository;
import com.iitp.iitp_rest.model.scenario.Scenario;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ScenarioRepository extends JpaRepository<Scenario, Long> {
    Optional<Scenario> findByKey(String key);
    boolean existsByKey(String key);
}
