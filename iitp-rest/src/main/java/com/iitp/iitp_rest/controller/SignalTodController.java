package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.signal.SignalTodXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.signal.SignalTodService;
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
            if (e.getCause() instanceof java.io.IOException)
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
        } catch (java.io.IOException e) {
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

    /** 현재 DB(또는 XML) 데이터를 signalTOD.xml 파일로 내보내기 */
    @GetMapping("/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String scenarioKey) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(signalTodService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            SignalTodXml xml = XmlLayerConverter.fromMap(data, SignalTodXml.class);
            byte[] bytes = signalTodService.marshalToXml(xml, SignalTodXml.class);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "signalTOD_" + scenarioKey + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[SignalTodController] export 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
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

    /** signalTOD.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importSignalTodXml(
            @PathVariable String scenarioKey,
            @RequestParam("file") MultipartFile file) {
        log.info("[SignalTodController] IMPORT scenarioKey={}, size={}bytes", scenarioKey, file.getSize());
        try {
            SignalTodXml xml = signalTodService.parse(file.getInputStream());
            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, data, new LogsData());
            signalTodService.saveByScenarioKey(scenarioKey, xml);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("[SignalTodController] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
