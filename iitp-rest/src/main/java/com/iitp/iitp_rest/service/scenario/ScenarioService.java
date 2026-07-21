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
    ScenarioVersion createVersion(Long scenarioId, String key, String label, String sourceVersionKey);
    void deleteVersion(Long scenarioId, Long versionId);
    void updateCoordinatesByKey(String key, double latitude, double longitude);
    /** rotationDeg/scale 이 null이면 기존 값을 건드리지 않는다 (호출부가 "회전/축척은 모름"인 경우). */
    void updateCoordinatesByKey(String key, double latitude, double longitude, Double rotationDeg, Double scale);
}

