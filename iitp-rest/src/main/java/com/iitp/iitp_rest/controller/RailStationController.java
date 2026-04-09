package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
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
@RequestMapping("/public-transit/station/rail")
@Slf4j
public class RailStationController {

    private final RailStationService railStationService;
    private final RailStationMapper railStationMapper;

    @GetMapping("/{versionId}")
    public ResponseEntity<RailPublicTransitResponse> getRailStationsByVersionId(@PathVariable String versionId) throws java.io.IOException {
        log.info("[getRailStationsByVersionId] versionId: {}", versionId);
        RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
        RailPublicTransitResponse body = railStationMapper.toResponse(xml);
        return ResponseEntity.ok(body);
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<RailPublicTransitResponse> getOriginRailStations(@PathVariable String versionId) {
        log.info("[getOriginRailStations] versionId: {}", versionId);
        try {
            RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
            RailPublicTransitResponse body = railStationMapper.toResponse(xml);
            return ResponseEntity.ok(body);
        } catch (java.io.FileNotFoundException e) {
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
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[saveRailStations] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
