package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationTileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;


@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station/rail")
@Slf4j
public class RailStationController {

    private final RailStationService railStationService;
    private final RailStationMapper railStationMapper;
    private final RailStationTileService railStationTileService;

    @GetMapping("/{versionId}")
    public ResponseEntity<RailPublicTransitResponse> getRailStationsByVersionId(@PathVariable String versionId) {
        log.info("[getRailStationsByVersionId] versionId: {}", versionId);
        try {
            RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
            RailPublicTransitResponse body = railStationMapper.toResponse(xml);
            return ResponseEntity.ok(body);
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[getRailStationsByVersionId] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 철도정류장 BBox 타일링 조회 (읽기 전용) — viewport 와 교차하는 정류장만 반환.
     * 기존 {@code GET /{versionId}} 와 병존.
     */
    @GetMapping("/{versionId}/tiles")
    public ResponseEntity<RailPublicTransitResponse> getRailStationTiles(
            @PathVariable String versionId,
            @RequestParam String bbox) {
        try {
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            List<RailStationResponse> stations = railStationTileService.queryByBbox(versionId, west, south, east, north);
            RailPublicTransitResponse result = new RailPublicTransitResponse();
            result.setRailStations(stations);
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[RailStationController] 타일 조회 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<RailPublicTransitResponse> getOriginRailStations(@PathVariable String versionId) {
        log.info("[getOriginRailStations] versionId: {}", versionId);
        try {
            RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
            RailPublicTransitResponse body = railStationMapper.toResponse(xml);
            return ResponseEntity.ok(body);
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[getOriginRailStations] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<RailStationLogs>> getLogsByVersion(@PathVariable String versionId) {
        log.info("[getLogsByVersion] versionId: {}", versionId);
        try {
            List<RailStationLogs> logs = railStationService.getLogsByVersion(versionId);
            return ResponseEntity.ok(logs);
        } catch (Exception e) {
            log.error("[getLogsByVersion] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/{versionId}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String versionId) {
        log.info("[exportAsXml] versionId: {}", versionId);
        try {
            byte[] bytes = railStationService.exportAsXml(versionId);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "railStation_" + versionId + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[exportAsXml] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveRailStations(@RequestBody RailStationSaveRequest request, @PathVariable String versionId) {
        log.info("[saveRailStations] versionId: {}", versionId);
        try {
            railStationService.saveRailStationByVersionId(request, versionId);
            // 타일 캐시 무효화 + 즉시 재빌드 — signal/busStation과 동일 패턴. 방금 저장한
            // 값을 XML에서 재조회(getRailStationXmlByVersionId)해 응답 형태로 변환한다.
            try {
                railStationTileService.invalidate(versionId);
                RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
                RailPublicTransitResponse saved = railStationMapper.toResponse(xml);
                railStationTileService.ingest(versionId, saved.getRailStations() != null ? saved.getRailStations() : List.of());
            } catch (Exception e) {
                log.warn("[saveRailStations] 정류장 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[saveRailStations] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** railStation.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{versionId}/import")
    public ResponseEntity<RailPublicTransitResponse> importRailStationXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) {
        log.info("[importRailStationXml] versionId: {}", versionId);
        try {
            RailPublicTransitResponse response = railStationService.importFromXml(file.getBytes(), versionId);
            try {
                railStationTileService.invalidate(versionId);
                railStationTileService.ingest(versionId, response.getRailStations() != null ? response.getRailStations() : List.of());
            } catch (Exception e) {
                log.warn("[importRailStationXml] 정류장 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("[importRailStationXml] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
