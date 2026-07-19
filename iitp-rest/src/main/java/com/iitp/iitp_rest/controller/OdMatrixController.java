package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.odmatrix.OdMatrixService;
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
@RequestMapping("/od-matrix")
@RequiredArgsConstructor
public class OdMatrixController {

    static final String LAYER_KEY = "od_matrix";

    private final OdMatrixService odMatrixService;
    private final XmlLayerVersionService xmlLayerVersionService;

    @GetMapping("/{versionId}")
    public ResponseEntity<Map<String, Object>> getOdMatrix(@PathVariable String versionId) {
        log.info("[OdMatrixController] GET versionId={}", versionId);
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, versionId,
                    () -> {
                        try { return XmlLayerConverter.toMap(odMatrixService.getByVersionId(versionId)); }
                        catch (Exception e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[OdMatrixController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<Map<String, Object>> getOriginOdMatrix(@PathVariable String versionId) {
        log.info("[OdMatrixController] GET origin versionId={}", versionId);
        try {
            return ResponseEntity.ok(XmlLayerConverter.toMap(odMatrixService.getByVersionId(versionId)));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[OdMatrixController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String versionId) {
        log.info("[OdMatrixController] GET histories versionId={}", versionId);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, versionId));
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveOdMatrix(
            @PathVariable String versionId,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[OdMatrixController] POST versionId={}", versionId);
        try {
            xmlLayerVersionService.save(LAYER_KEY, versionId, request.getData(), request.getLogs());
            // 파일 소비자(NextSim 시뮬 입력, XML export) 동기화 — DB 레이어만 쓰면
            // UI 로 만든 OD 가 odmatrix.xml 로 존재하지 않아 시뮬 실행이 "OD 없음" 이 된다
            try {
                odMatrixService.saveByVersionId(versionId,
                        XmlLayerConverter.fromMap(request.getData(),
                                com.iitp.iitp_rest.model.odmatrix.OdMatrixXml.class));
            } catch (Exception fileErr) {
                log.warn("[OdMatrixController] odmatrix.xml 파일 동기화 실패(DB 저장은 완료): {}", fileErr.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[OdMatrixController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
