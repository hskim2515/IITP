package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.signal.SignalTodService;
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
@RequestMapping("/signal-tod")
@RequiredArgsConstructor
public class SignalTodController {

    static final String LAYER_KEY = "signal_tod";

    private final SignalTodService signalTodService;
    private final XmlLayerVersionService xmlLayerVersionService;

    /** DB 우선, 없으면 XML fallback */
    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getSignalTod(@PathVariable String scenarioKey) {
        log.info("[SignalTodController] GET scenarioKey={}", scenarioKey);
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(signalTodService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[SignalTodController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 항상 XML 원본 반환 */
    @GetMapping("/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginSignalTod(@PathVariable String scenarioKey) {
        log.info("[SignalTodController] GET origin scenarioKey={}", scenarioKey);
        try {
            Map<String, Object> result = XmlLayerConverter.toMap(signalTodService.getByScenarioKey(scenarioKey));
            return ResponseEntity.ok(result);
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[SignalTodController] origin 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 변경 이력 목록 */
    @GetMapping("/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String scenarioKey) {
        log.info("[SignalTodController] GET histories scenarioKey={}", scenarioKey);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, scenarioKey));
    }

    /** DB 저장 + 로그 추가 */
    @PostMapping("/{scenarioKey}")
    public ResponseEntity<Void> saveSignalTod(
            @PathVariable String scenarioKey,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[SignalTodController] POST scenarioKey={}", scenarioKey);
        try {
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, request.getData(), request.getLogs());
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[SignalTodController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
