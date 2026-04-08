package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.service.odmatrix.OdMatrixService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/od-matrix")
@RequiredArgsConstructor
public class OdMatrixController {

    private final OdMatrixService odMatrixService;

    @GetMapping("/{versionId}")
    public ResponseEntity<OdMatrixXml> getOdMatrix(@PathVariable String versionId) {
        log.info("[OdMatrixController] GET versionId={}", versionId);
        try {
            OdMatrixXml result = odMatrixService.getByVersionId(versionId);
            return ResponseEntity.ok(result);
        } catch (java.io.FileNotFoundException e) {
            log.warn("[OdMatrixController] 파일 없음: {}", versionId);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[OdMatrixController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveOdMatrix(
            @PathVariable String versionId,
            @RequestBody OdMatrixXml odMatrix
    ) {
        log.info("[OdMatrixController] POST versionId={}", versionId);
        try {
            odMatrixService.saveByVersionId(versionId, odMatrix);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[OdMatrixController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
