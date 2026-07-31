package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.bus.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationTileService;
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
@RequestMapping("/public-transit/station/bus")
@Slf4j
public class BusStationController {

    private final BusStationService busStationService;
    private final BusStationTileService busStationTileService;

    @GetMapping("/{versionId}")
    public ResponseEntity<PublicTransitResponse> getBusStationsByVersionId(@PathVariable String versionId) {
        log.info("[getBusStationsByVersionId] versionId: {}", versionId);
        try {
            PublicTransitResponse body = busStationService.getBusStationsByVersionId(versionId);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            Throwable cause = e instanceof RuntimeException ? e.getCause() : e;
            if (cause instanceof java.io.IOException) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }
            log.error("[getBusStationsByVersionId] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 버스정류장 BBox 타일링 조회 (읽기 전용) — viewport 와 교차하는 정류장만 반환.
     * 정류장은 네트워크 링크에 종속 → 링크 시작 좌표로 bbox 산정. 기존 {@code GET /{versionId}} 와 병존.
     */
    @GetMapping("/{versionId}/tiles")
    public ResponseEntity<PublicTransitResponse> getBusStationTiles(
            @PathVariable String versionId,
            @RequestParam String bbox) {
        try {
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            List<BusStationResponse> stations = busStationTileService.queryByBbox(versionId, west, south, east, north);
            PublicTransitResponse result = new PublicTransitResponse();
            result.setBusStations(stations);
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[BusStationController] 타일 조회 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<PublicTransitResponse> getOriginBusStations(@PathVariable String versionId) {
        log.info("[getOriginBusStations] versionId: {}", versionId);
        try {
            PublicTransitResponse body = busStationService.getOriginByVersionId(versionId);
            return ResponseEntity.ok(body);
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[getOriginBusStations] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<BusStationLogs>> getLogsByVersion(@PathVariable String versionId) {
        log.info("[getLogsByVersion] versionId: {}", versionId);
        try {
            List<BusStationLogs> logs = busStationService.getLogsByVersionId(versionId);
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
            byte[] bytes = busStationService.exportAsXml(versionId);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "roadStation_" + versionId + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[exportAsXml] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveBusStations(@RequestBody BusStationSaveRequest request, @PathVariable String versionId) {
        log.info("[saveBusStations] versionId: {}", versionId);
        try {
            busStationService.saveBusStationsByVersionId(request, versionId);
            // 타일 캐시 무효화 + 즉시 재빌드 — signal과 동일 패턴. request.getData()는
            // BusStationData(저장용)라 타일용 BusStationResponse와 형태가 달라, 방금 저장한
            // 값을 그대로 재조회(getBusStationsByVersionId)해 변환 로직을 재사용한다.
            // 첫 정류장 타일 요청(lazy 빌드)을 저장 처리 시간으로 흡수.
            try {
                busStationTileService.invalidate(versionId);
                List<BusStationResponse> saved = busStationService.getBusStationsByVersionId(versionId).getBusStations();
                busStationTileService.ingest(versionId, saved != null ? saved : List.of());
            } catch (Exception e) {
                log.warn("[saveBusStations] 정류장 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[saveBusStations] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** roadStation.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{versionId}/import")
    public ResponseEntity<PublicTransitResponse> importBusStationXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) {
        log.info("[BusStationController] IMPORT versionId={}, size={}bytes", versionId, file.getSize());
        try {
            PublicTransitResponse response = busStationService.importFromXml(file.getBytes(), versionId);
            try {
                busStationTileService.invalidate(versionId);
                busStationTileService.ingest(versionId, response.getBusStations() != null ? response.getBusStations() : List.of());
            } catch (Exception e) {
                log.warn("[importBusStationXml] 정류장 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("[importBusStationXml] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
