package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.passenger.PassengerXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.passenger.PassengerService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/passenger")
@RequiredArgsConstructor
public class PassengerController {

    static final String LAYER_KEY = "passenger";

    private final PassengerService passengerService;
    private final XmlLayerVersionService xmlLayerVersionService;

    @GetMapping("/{versionId}")
    public ResponseEntity<Map<String, Object>> getPassenger(@PathVariable String versionId) {
        log.info("[PassengerController] GET versionId={}", versionId);
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, versionId,
                    () -> {
                        try { return XmlLayerConverter.toMap(passengerService.getByVersionId(versionId)); }
                        catch (Exception e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[PassengerController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<Map<String, Object>> getOriginPassenger(@PathVariable String versionId) {
        log.info("[PassengerController] GET origin versionId={}", versionId);
        try {
            return ResponseEntity.ok(XmlLayerConverter.toMap(passengerService.getByVersionId(versionId)));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[PassengerController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String versionId) {
        log.info("[PassengerController] GET histories versionId={}", versionId);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, versionId));
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> savePassenger(
            @PathVariable String versionId,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[PassengerController] POST versionId={}", versionId);
        try {
            PassengerXml newPassenger = XmlLayerConverter.fromMap(request.getData(), PassengerXml.class);
            Map<String, Object> cleanData = XmlLayerConverter.toMap(newPassenger);
            xmlLayerVersionService.save(LAYER_KEY, versionId, cleanData, request.getLogs());
            // 파일 소비자(NextSim 시뮬 입력) 동기화 — DB 레이어만 쓰면 UI로 만든 승객 수요가
            // passenger.xml로 존재하지 않아 NextSimRunner가 빈 od_pax로 폴백한다
            try {
                passengerService.saveByVersionId(versionId, newPassenger);
            } catch (Exception fileErr) {
                log.warn("[PassengerController] passenger.xml 파일 동기화 실패(DB 저장은 완료): {}", fileErr.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[PassengerController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** passenger.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{versionId}/import")
    public ResponseEntity<Map<String, Object>> importPassengerXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) {
        log.info("[PassengerController] IMPORT versionId={}, size={}bytes", versionId, file.getSize());
        try {
            PassengerXml xml = passengerService.parse(file.getInputStream());
            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, versionId, data, new LogsData());
            passengerService.saveByVersionId(versionId, xml);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("[PassengerController] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
