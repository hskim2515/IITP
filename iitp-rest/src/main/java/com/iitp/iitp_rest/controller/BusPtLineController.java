package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.line.BusPtLineService;
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

    @GetMapping("/{scenarioKey}/export")
    public ResponseEntity<byte[]> export(@PathVariable String scenarioKey) {
        return exportResp(scenarioKey, LAYER_KEY_DEFAULT, () -> ioWrap(() -> busPtLineService.getDefault(scenarioKey)),
                "roadPTline_" + scenarioKey + ".xml");
    }

    @PostMapping("/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importDefault(@PathVariable String scenarioKey, @RequestParam("file") MultipartFile file) {
        return importResp(LAYER_KEY_DEFAULT, scenarioKey, file, busPtLineService::saveDefault);
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

    @GetMapping("/weekday/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportWeekday(@PathVariable String scenarioKey) {
        return exportResp(scenarioKey, LAYER_KEY_WEEKDAY, () -> ioWrap(() -> busPtLineService.getWeekday(scenarioKey)),
                "roadPTline-weekday_" + scenarioKey + ".xml");
    }

    @PostMapping("/weekday/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importWeekday(@PathVariable String scenarioKey, @RequestParam("file") MultipartFile file) {
        return importResp(LAYER_KEY_WEEKDAY, scenarioKey, file, busPtLineService::saveWeekday);
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

    @GetMapping("/weekend/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportWeekend(@PathVariable String scenarioKey) {
        return exportResp(scenarioKey, LAYER_KEY_WEEKEND, () -> ioWrap(() -> busPtLineService.getWeekend(scenarioKey)),
                "roadPTline-weekend_" + scenarioKey + ".xml");
    }

    @PostMapping("/weekend/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importWeekend(@PathVariable String scenarioKey, @RequestParam("file") MultipartFile file) {
        return importResp(LAYER_KEY_WEEKEND, scenarioKey, file, busPtLineService::saveWeekend);
    }

    // ── private helpers ──────────────────────────────────────────────
    private ResponseEntity<Map<String, Object>> fetchLatest(String key, String layerKey,
                                                             Supplier<Map<String, Object>> xml) {
        log.info("[BusPtLineController] GET layerKey={} key={}", layerKey, key);
        try {
            return ResponseEntity.ok(xmlLayerVersionService.getLatest(layerKey, key, xml));
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[BusPtLineController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private ResponseEntity<Map<String, Object>> originResp(Supplier<Map<String, Object>> xml) {
        try {
            return ResponseEntity.ok(xml.get());
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException)
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

    private ResponseEntity<byte[]> exportResp(String key, String layerKey,
                                               Supplier<Map<String, Object>> xmlFetcher, String filename) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(layerKey, key, xmlFetcher);
            BusPtLinesXml xml = XmlLayerConverter.fromMap(data, BusPtLinesXml.class);
            byte[] bytes = busPtLineService.marshalToXml(xml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[BusPtLineController] export 오류 layerKey={}", layerKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private Map<String, Object> ioWrap(IOSupplier<Object> s) {
        try { return XmlLayerConverter.toMap(s.get()); }
        catch (java.io.IOException e) { throw new RuntimeException(e); }
    }

    /** XML 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 (default/weekday/weekend 공용) */
    private ResponseEntity<Map<String, Object>> importResp(String layerKey, String scenarioKey,
                                                             MultipartFile file, FileSyncer syncer) {
        log.info("[BusPtLineController] IMPORT layerKey={} scenarioKey={} size={}bytes", layerKey, scenarioKey, file.getSize());
        try {
            BusPtLinesXml xml = busPtLineService.parse(file.getInputStream());
            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(layerKey, scenarioKey, data, new LogsData());
            syncer.save(scenarioKey, xml);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("[BusPtLineController] 임포트 오류 layerKey={}", layerKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @FunctionalInterface
    interface IOSupplier<T> { T get() throws java.io.IOException; }

    @FunctionalInterface
    interface FileSyncer { void save(String scenarioKey, BusPtLinesXml xml) throws Exception; }
}
