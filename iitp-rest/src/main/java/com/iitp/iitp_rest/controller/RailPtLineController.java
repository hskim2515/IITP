package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.line.RailPtLineService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/public-transit/line/rail")
@RequiredArgsConstructor
public class RailPtLineController {

    static final String LAYER_KEY = "rail_pt_line";

    private final RailPtLineService railPtLineService;
    private final XmlLayerVersionService xmlLayerVersionService;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getRailPtLine(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] GET scenarioKey={}", scenarioKey);
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(railPtLineService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[RailPtLineController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginRailPtLine(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] GET origin scenarioKey={}", scenarioKey);
        try {
            return ResponseEntity.ok(XmlLayerConverter.toMap(railPtLineService.getByScenarioKey(scenarioKey)));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[RailPtLineController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] GET histories scenarioKey={}", scenarioKey);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, scenarioKey));
    }

    @PostMapping("/{scenarioKey}")
    public ResponseEntity<Void> saveRailPtLine(
            @PathVariable String scenarioKey,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[RailPtLineController] POST scenarioKey={}", scenarioKey);
        try {
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, request.getData(), request.getLogs());
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[RailPtLineController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
