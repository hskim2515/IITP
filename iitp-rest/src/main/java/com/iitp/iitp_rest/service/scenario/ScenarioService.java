package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;

import java.util.List;

public interface ScenarioService {
    List<Scenario> getAllScenarios();
    Scenario getScenarioById(Long id);
    List<ScenarioVersion> getVersionsByScenarioId(Long scenarioId);
    Scenario getScenarioByKey(String key);
}

