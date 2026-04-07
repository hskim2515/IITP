package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.signal.SignalTodXml;
import com.iitp.iitp_rest.service.signal.SignalTodService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/signal-tod")
@RequiredArgsConstructor
public class SignalTodController {

    private final SignalTodService signalTodService;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<SignalTodXml> getSignalTod(@PathVariable String scenarioKey) {
        log.info("[SignalTodController] scenarioKey={}", scenarioKey);
        try {
            SignalTodXml result = signalTodService.getByScenarioKey(scenarioKey);
            return ResponseEntity.ok(result);
        } catch (java.io.FileNotFoundException e) {
            log.warn("[SignalTodController] 파일 없음: {}", scenarioKey);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[SignalTodController] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
