package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.line.BusPtLineService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * 버스 노선 컨트롤러
 * URL 구조: /public-transit/line/bus/{variant}/{scenarioKey}
 *   variant = (없음) | weekday | weekend
 *   action  = (없음) | histories | origin
 *
 * 경로 모호성 방지: variant 파라미터를 먼저 받고 scenarioKey를 두 번째로 받는 구조 사용
 */
@Slf4j
@RestController
@RequestMapping("/public-transit/line/bus")
@RequiredArgsConstructor
public class BusPtLineController {

    static final String LAYER_KEY_DEFAULT  = "bus_pt_line";
    static final String LAYER_KEY_WEEKDAY  = "bus_pt_line_weekday";
    static final String LAYER_KEY_WEEKEND  = "bus_pt_line_weekend";

    private final BusPtLineService busPtLineService;
    private final XmlLayerVersionService xmlLayerVersionService;

    // ── default ─────────────────────────────────────────────────────
    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable String scenarioKey) {
        return fetchLatest(scenarioKey, LAYER_KEY_DEFAULT, () -> ioWrap(() -> busPtLineService.getDefault(scenarioKey)));
    }

    @GetMapping("/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOrigin(@PathVariable String scenarioKey) {
        return originResp(() -> ioWrap(() -> busPtLineService.getDefault(scenarioKey)));
    }

    @GetMapping("/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String scenarioKey) {
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY_DEFAULT, scenarioKey));
    }

    @PostMapping("/{scenarioKey}")
    public ResponseEntity<Void> save(@PathVariable String scenarioKey, @RequestBody XmlLayerSaveRequest req) {
        return saveResp(LAYER_KEY_DEFAULT, scenarioKey, req);
    }

    // ── weekday ──────────────────────────────────────────────────────
    @GetMapping("/weekday/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getWeekday(@PathVariable String scenarioKey) {
        return fetchLatest(scenarioKey, LAYER_KEY_WEEKDAY, () -> ioWrap(() -> busPtLineService.getWeekday(scenarioKey)));
    }

    @GetMapping("/weekday/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginWeekday(@PathVariable String scenarioKey) {
        return originResp(() -> ioWrap(() -> busPtLineService.getWeekday(scenarioKey)));
    }

    @GetMapping("/weekday/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistoriesWeekday(@PathVariable String scenarioKey) {
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY_WEEKDAY, scenarioKey));
    }

    @PostMapping("/weekday/{scenarioKey}")
    public ResponseEntity<Void> saveWeekday(@PathVariable String scenarioKey, @RequestBody XmlLayerSaveRequest req) {
        return saveResp(LAYER_KEY_WEEKDAY, scenarioKey, req);
    }

    // ── weekend ──────────────────────────────────────────────────────
    @GetMapping("/weekend/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getWeekend(@PathVariable String scenarioKey) {
        return fetchLatest(scenarioKey, LAYER_KEY_WEEKEND, () -> ioWrap(() -> busPtLineService.getWeekend(scenarioKey)));
    }

    @GetMapping("/weekend/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginWeekend(@PathVariable String scenarioKey) {
        return originResp(() -> ioWrap(() -> busPtLineService.getWeekend(scenarioKey)));
    }

    @GetMapping("/weekend/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistoriesWeekend(@PathVariable String scenarioKey) {
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY_WEEKEND, scenarioKey));
    }

    @PostMapping("/weekend/{scenarioKey}")
    public ResponseEntity<Void> saveWeekend(@PathVariable String scenarioKey, @RequestBody XmlLayerSaveRequest req) {
        return saveResp(LAYER_KEY_WEEKEND, scenarioKey, req);
    }

    // ── private helpers ──────────────────────────────────────────────
    private ResponseEntity<Map<String, Object>> fetchLatest(String key, String layerKey,
                                                             Supplier<Map<String, Object>> xml) {
        log.info("[BusPtLineController] GET layerKey={} key={}", layerKey, key);
        try {
            return ResponseEntity.ok(xmlLayerVersionService.getLatest(layerKey, key, xml));
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[BusPtLineController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private ResponseEntity<Map<String, Object>> originResp(Supplier<Map<String, Object>> xml) {
        try {
            return ResponseEntity.ok(xml.get());
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[BusPtLineController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private ResponseEntity<Void> saveResp(String layerKey, String key, XmlLayerSaveRequest req) {
        log.info("[BusPtLineController] POST layerKey={} key={}", layerKey, key);
        try {
            xmlLayerVersionService.save(layerKey, key, req.getData(), req.getLogs());
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[BusPtLineController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private Map<String, Object> ioWrap(IOSupplier<Object> s) {
        try { return XmlLayerConverter.toMap(s.get()); }
        catch (java.io.IOException e) { throw new RuntimeException(e); }
    }

    @FunctionalInterface
    interface IOSupplier<T> { T get() throws java.io.IOException; }
}
