package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;


@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station/rail")
@Slf4j
public class RailStationController {

    private final RailStationService railStationService;
    private final RailStationMapper railStationMapper;

    @GetMapping("/{versionId}")
    public ResponseEntity<RailPublicTransitResponse> getRailStationsByVersionId(@PathVariable String versionId) {
        log.info("[getRailStationsByVersionId] scenarioKey: {}", versionId);

        RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
        RailPublicTransitResponse body = railStationMapper.toResponse(xml);
        return ResponseEntity.ok(body);
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveBusStations(@RequestBody RailStationSaveRequest request, @PathVariable String versionId) {
        log.info("[RailStationSaveRequest] request: {} versionId: {}", request, versionId);
        try {
            railStationService.saveRailStationByVersionId(request, versionId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
