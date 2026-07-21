package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.line.RailPtLineService;
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
            if (e.getCause() instanceof java.io.IOException)
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
        } catch (java.io.IOException e) {
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

    @GetMapping("/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String scenarioKey) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(railPtLineService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            RailPtLineXml xml = XmlLayerConverter.fromMap(data, RailPtLineXml.class);
            byte[] bytes = railPtLineService.marshalToXml(xml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "railPTLine_" + scenarioKey + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[RailPtLineController] export 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
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

    /** railPTLine.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importRailPtLineXml(
            @PathVariable String scenarioKey,
            @RequestParam("file") MultipartFile file) {
        log.info("[RailPtLineController] IMPORT scenarioKey={}, size={}bytes", scenarioKey, file.getSize());
        try {
            RailPtLineXml xml = railPtLineService.parse(file.getInputStream());
            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, data, new LogsData());
            railPtLineService.saveByScenarioKey(scenarioKey, xml);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("[RailPtLineController] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
