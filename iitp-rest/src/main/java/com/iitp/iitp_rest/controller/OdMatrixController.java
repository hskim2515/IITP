package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.odmatrix.OdMatrixService;
import com.iitp.iitp_rest.service.odmatrix.OdTerminalIdBandService;
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
@RequestMapping("/od-matrix")
@RequiredArgsConstructor
public class OdMatrixController {

    static final String LAYER_KEY = "od_matrix";

    private final OdMatrixService odMatrixService;
    private final XmlLayerVersionService xmlLayerVersionService;
    private final OdTerminalIdBandService odTerminalIdBandService;

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
            OdMatrixXml newOd = XmlLayerConverter.fromMap(request.getData(), OdMatrixXml.class);

            // route-generator 크래시 회귀 방지 — 이번에 source/sink 로 추가·제거되는 노드만
            // 현재 degree 에 맞는 id 대역(터미널 11M~/일반 10M~)으로 보정. 기존에 이미
            // 참조되고 있던(안 바뀐) 노드 id 는 절대 건드리지 않음 — 다른 OD 항목·신호 등
            // 기존 참조가 깨지지 않도록.
            OdMatrixXml oldOd;
            try {
                oldOd = odMatrixService.getByVersionId(versionId);
            } catch (java.io.FileNotFoundException e) {
                oldOd = null; // 최초 저장 — 이전 OD 없음
            }
            try {
                Map<String, String> idRemap = odTerminalIdBandService.reconcileTerminalIds(versionId, oldOd, newOd);
                if (!idRemap.isEmpty()) {
                    odTerminalIdBandService.applyRemapToOdMatrix(newOd, idRemap);
                }
            } catch (Exception idErr) {
                log.warn("[OdMatrixController] 터미널 id 대역 보정 실패(무시하고 저장 계속): {}", idErr.getMessage());
            }

            Map<String, Object> cleanData = XmlLayerConverter.toMap(newOd);
            xmlLayerVersionService.save(LAYER_KEY, versionId, cleanData, request.getLogs());
            // 파일 소비자(NextSim 시뮬 입력, XML export) 동기화 — DB 레이어만 쓰면
            // UI 로 만든 OD 가 odmatrix.xml 로 존재하지 않아 시뮬 실행이 "OD 없음" 이 된다
            try {
                odMatrixService.saveByVersionId(versionId, newOd);
            } catch (Exception fileErr) {
                log.warn("[OdMatrixController] odmatrix.xml 파일 동기화 실패(DB 저장은 완료): {}", fileErr.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[OdMatrixController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** odmatrix.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{versionId}/import")
    public ResponseEntity<Map<String, Object>> importOdMatrixXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) {
        log.info("[OdMatrixController] IMPORT versionId={}, size={}bytes", versionId, file.getSize());
        try {
            OdMatrixXml xml = odMatrixService.parse(file.getInputStream());
            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, versionId, data, new LogsData());
            odMatrixService.saveByVersionId(versionId, xml);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("[OdMatrixController] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
