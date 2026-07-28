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
            // DB 저장과 동시에 실제 railPTline.xml 파일도 SFTP에 동기화한다
            // (SignalController.saveSignal / BusPtLineController.saveResp와 동일 패턴).
            // 이게 없으면 앱에서 철도 노선을 편집/저장해도 DB 캐시(xml_layer_versions,
            // 편집 UI/undo용)에만 반영되고, NextSim이 실제로 읽는 SFTP의 railPTline.xml은
            // 전혀 갱신되지 않아 시뮬레이션에 반영되지 않는다(import로만 실제 파일이
            // 생성되던 버스 노선과 동일 버그).
            try {
                RailPtLineXml xml = XmlLayerConverter.fromMap(request.getData(), RailPtLineXml.class);
                railPtLineService.saveByScenarioKey(scenarioKey, xml);
            } catch (Exception e) {
                log.warn("[RailPtLineController] XML 파일 동기화 실패(DB는 정상 저장됨) scenarioKey={}: {}",
                        scenarioKey, e.getMessage());
            }
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
