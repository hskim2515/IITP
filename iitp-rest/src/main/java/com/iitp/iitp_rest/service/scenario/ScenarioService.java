package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;

import java.util.List;

public interface ScenarioService {
    List<Scenario> getAllScenarios();
    Scenario getScenarioById(Long id);
    List<ScenarioVersion> getVersionsByScenarioId(Long scenarioId);
    Scenario getScenarioByKey(String key);
    ScenarioVersion getVersionByKey(String key);
    Scenario createScenario(Scenario scenario);
    Scenario updateScenario(Long id, Scenario scenario);
    void deleteScenario(Long id);
    boolean existsByKey(String key);
    ScenarioVersion createVersion(Long scenarioId, String key, String label);
    void deleteVersion(Long scenarioId, Long versionId);
    void updateCoordinatesByKey(String key, double latitude, double longitude);
}

