package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.bus.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station/bus")
@Slf4j
public class BusStationController {

    private final BusStationService busStationService;

    @GetMapping("/{versionId}")
    public ResponseEntity<PublicTransitResponse> getBusStationsByVersionId(@PathVariable String versionId) throws java.io.IOException {
        log.info("[getBusStationsByVersionId] versionId: {}", versionId);
        PublicTransitResponse body = busStationService.getBusStationsByVersionId(versionId);
        return ResponseEntity.ok(body);
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<PublicTransitResponse> getOriginBusStations(@PathVariable String versionId) {
        log.info("[getOriginBusStations] versionId: {}", versionId);
        try {
            PublicTransitResponse body = busStationService.getOriginByVersionId(versionId);
            return ResponseEntity.ok(body);
        } catch (java.io.FileNotFoundException e) {
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
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[saveBusStations] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
