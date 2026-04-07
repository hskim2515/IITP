package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.scenario.SimulationRunXml;
import com.iitp.iitp_rest.service.scenario.SimulationRunService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/simulation-scenario")
@RequiredArgsConstructor
public class SimulationScenarioController {

    private final SimulationRunService simulationRunService;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<SimulationRunXml> getSimulationScenario(@PathVariable String scenarioKey) {
        log.info("[SimulationScenarioController] scenarioKey={}", scenarioKey);
        try {
            SimulationRunXml result = simulationRunService.getByScenarioKey(scenarioKey);
            return ResponseEntity.ok(result);
        } catch (java.io.FileNotFoundException e) {
            log.warn("[SimulationScenarioController] 파일 없음: {}", scenarioKey);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[SimulationScenarioController] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
