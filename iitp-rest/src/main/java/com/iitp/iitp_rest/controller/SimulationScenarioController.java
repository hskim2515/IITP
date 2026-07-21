package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.scenario.SimulationRunXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.scenario.SimulationRunService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/simulation-scenario")
@RequiredArgsConstructor
public class SimulationScenarioController {

    static final String LAYER_KEY = "simulation_scenario";

    private final SimulationRunService simulationRunService;
    private final XmlLayerVersionService xmlLayerVersionService;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getSimulationScenario(@PathVariable String scenarioKey) {
        log.info("[SimulationScenarioController] GET scenarioKey={}", scenarioKey);
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(simulationRunService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[SimulationScenarioController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginScenario(@PathVariable String scenarioKey) {
        log.info("[SimulationScenarioController] GET origin scenarioKey={}", scenarioKey);
        try {
            return ResponseEntity.ok(XmlLayerConverter.toMap(simulationRunService.getByScenarioKey(scenarioKey)));
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[SimulationScenarioController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String scenarioKey) {
        log.info("[SimulationScenarioController] GET histories scenarioKey={}", scenarioKey);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, scenarioKey));
    }

    @GetMapping("/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String scenarioKey) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(simulationRunService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            SimulationRunXml xml = XmlLayerConverter.fromMap(data, SimulationRunXml.class);
            byte[] bytes = simulationRunService.marshalToXml(xml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "scenario_" + scenarioKey + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[SimulationScenarioController] export 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{scenarioKey}")
    public ResponseEntity<Void> saveSimulationScenario(
            @PathVariable String scenarioKey,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[SimulationScenarioController] POST scenarioKey={}", scenarioKey);
        try {
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, request.getData(), request.getLogs());
            // 파일 소비자(NextSim 시뮬 입력) 동기화 — scenario.xml 도 파일로 존재해야 실행 시 반영
            try {
                simulationRunService.saveByScenarioKey(scenarioKey,
                        XmlLayerConverter.fromMap(request.getData(), SimulationRunXml.class));
            } catch (Exception fileErr) {
                log.warn("[SimulationScenarioController] scenario.xml 파일 동기화 실패(DB 저장은 완료): {}", fileErr.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[SimulationScenarioController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** scenario.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importScenarioXml(
            @PathVariable String scenarioKey,
            @RequestParam("file") MultipartFile file) {
        log.info("[SimulationScenarioController] IMPORT scenarioKey={}, size={}bytes", scenarioKey, file.getSize());
        try {
            SimulationRunXml xml = simulationRunService.parse(file.getInputStream());
            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, data, new LogsData());
            simulationRunService.saveByScenarioKey(scenarioKey, xml);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("[SimulationScenarioController] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
