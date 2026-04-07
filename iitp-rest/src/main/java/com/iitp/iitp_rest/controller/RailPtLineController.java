package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
import com.iitp.iitp_rest.service.publicTransit.line.RailPtLineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/public-transit/line/rail")
@RequiredArgsConstructor
public class RailPtLineController {

    private final RailPtLineService railPtLineService;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<RailPtLineXml> getRailPtLine(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] scenarioKey={}", scenarioKey);
        try {
            RailPtLineXml result = railPtLineService.getByScenarioKey(scenarioKey);
            return ResponseEntity.ok(result);
        } catch (java.io.FileNotFoundException e) {
            log.warn("[RailPtLineController] 파일 없음: {}", scenarioKey);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[RailPtLineController] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
