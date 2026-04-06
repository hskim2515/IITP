package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class ScenarioServiceImpl implements ScenarioService {

    private final ScenarioRepository scenarioRepository;
    private final ScenarioVersionRepository versionRepository;

    @Override
    public List<Scenario> getAllScenarios() {
        return scenarioRepository.findAll();
    }

    @Override
    public Scenario getScenarioById(Long id) {
        return scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
    }

    @Override
    public List<ScenarioVersion> getVersionsByScenarioId(Long scenarioId) {
        return versionRepository.findByScenarioId(scenarioId);
    }

    @Override
    public Scenario getScenarioByKey(String key) {
        return scenarioRepository.findByKey(key)
                .orElseThrow(() -> new RuntimeException("Scenario not found key: " + key));
    }

    @Override
    public ScenarioVersion getVersionByKey(String key) {
        return versionRepository.findByKey(key)
                .orElseThrow(() -> new RuntimeException("ScenarioVersion not found key: " + key));
    }
}

