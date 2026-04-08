package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.service.publicTransit.line.BusPtLineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/public-transit/line/bus")
@RequiredArgsConstructor
public class BusPtLineController {

    private final BusPtLineService busPtLineService;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<BusPtLinesXml> getBusPtLine(@PathVariable String scenarioKey) {
        return fetch(scenarioKey, "default");
    }

    @GetMapping("/weekday/{scenarioKey}")
    public ResponseEntity<BusPtLinesXml> getBusPtLineWeekday(@PathVariable String scenarioKey) {
        return fetch(scenarioKey, "weekday");
    }

    @GetMapping("/weekend/{scenarioKey}")
    public ResponseEntity<BusPtLinesXml> getBusPtLineWeekend(@PathVariable String scenarioKey) {
        return fetch(scenarioKey, "weekend");
    }

    @PostMapping("/{scenarioKey}")
    public ResponseEntity<Void> saveBusPtLine(@PathVariable String scenarioKey, @RequestBody BusPtLinesXml data) {
        return save(scenarioKey, "default", data);
    }

    @PostMapping("/weekday/{scenarioKey}")
    public ResponseEntity<Void> saveBusPtLineWeekday(@PathVariable String scenarioKey, @RequestBody BusPtLinesXml data) {
        return save(scenarioKey, "weekday", data);
    }

    @PostMapping("/weekend/{scenarioKey}")
    public ResponseEntity<Void> saveBusPtLineWeekend(@PathVariable String scenarioKey, @RequestBody BusPtLinesXml data) {
        return save(scenarioKey, "weekend", data);
    }

    private ResponseEntity<BusPtLinesXml> fetch(String scenarioKey, String type) {
        log.info("[BusPtLineController] GET scenarioKey={}, type={}", scenarioKey, type);
        try {
            BusPtLinesXml result = switch (type) {
                case "weekday" -> busPtLineService.getWeekday(scenarioKey);
                case "weekend" -> busPtLineService.getWeekend(scenarioKey);
                default -> busPtLineService.getDefault(scenarioKey);
            };
            return ResponseEntity.ok(result);
        } catch (java.io.FileNotFoundException e) {
            log.warn("[BusPtLineController] 파일 없음: {}/{}", scenarioKey, type);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[BusPtLineController] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private ResponseEntity<Void> save(String scenarioKey, String type, BusPtLinesXml data) {
        log.info("[BusPtLineController] POST scenarioKey={}, type={}", scenarioKey, type);
        try {
            switch (type) {
                case "weekday" -> busPtLineService.saveWeekday(scenarioKey, data);
                case "weekend" -> busPtLineService.saveWeekend(scenarioKey, data);
                default        -> busPtLineService.saveDefault(scenarioKey, data);
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[BusPtLineController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
