package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.publicTransit.BusStationMapper;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXml;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station/bus")
@Slf4j
public class BusStationController {

    private final BusStationService busStationService;
    private final BusStationMapper busStationMapper;

    @GetMapping("/{versionId}")
    public ResponseEntity<PublicTransitResponse> getBusStationsByVersionId(@PathVariable String versionId) throws java.io.IOException {
        log.info("[getBusStationsByVersionId] versionId: {}", versionId);

        PublicTransitXml xml = busStationService.getBusStationXmlByVersionId(versionId);
        PublicTransitResponse body = busStationMapper.toResponse(xml);
        return ResponseEntity.ok(body);
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveBusStations(@RequestBody BusStationSaveRequest request, @PathVariable String versionId) {
        log.info("[BusStationSaveRequest] request: {} versionId: {}", request, versionId);
        try {
            busStationService.saveBusStationsByVersionId(request, versionId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
