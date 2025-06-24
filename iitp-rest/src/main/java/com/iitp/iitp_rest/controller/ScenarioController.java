package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/scenario")
@RequiredArgsConstructor
public class ScenarioController {

    private final ScenarioService scenarioService;

    @GetMapping
    public List<Scenario> getAllScenarios() {
        return scenarioService.getAllScenarios();
    }

    @GetMapping("/{id}")
    public Scenario getScenarioById(@PathVariable Long id) {
        return scenarioService.getScenarioById(id);
    }

    @GetMapping("/{id}/versions")
    public List<ScenarioVersion> getScenarioVersions(@PathVariable Long id) {
        return scenarioService.getVersionsByScenarioId(id);
    }
}

