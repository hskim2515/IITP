package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.bus.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitData;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXmlResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitData;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXmlResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.xml.stream.XMLStreamException;
import java.io.IOException;
import java.util.List;


@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station")
@Slf4j
public class StationController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final BusStationService busStationService;
    private final RailStationService railStationService;

    @GetMapping("/bus/{versionId}")
    public ResponseEntity<PublicTransitXmlResponse> getBusStation(@PathVariable String versionId) throws XMLStreamException, IOException {
        logger.info("[getBusStation] versionId: {}", versionId);

        PublicTransitXmlResponse result = busStationService.getBusStation(versionId);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/bus/history/{versionId}")
    public ResponseEntity<List<BusStationLogs>> getLogsByVersion(@PathVariable String versionId) {
        logger.info("[getLogsByVersion] versionId: {}", versionId);
        List<BusStationLogs> logs = busStationService.getLogsByVersion(versionId);

        return ResponseEntity.ok(logs);

    }

    @PostMapping("/bus/{versionId}")
    public ResponseEntity<Void> saveBusStation(@RequestBody BusStationSaveRequest request, @PathVariable String versionId) {
        logger.info("[saveBusStation] request: {}", request);
        try {
            busStationService.saveBusStation(request, versionId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/rail/{versionId}")
    public ResponseEntity<RailPublicTransitXmlResponse> getRailStation(@PathVariable String versionId) throws XMLStreamException {
        logger.info("[getRailStation] versionId: {}", versionId);

        RailPublicTransitXmlResponse result = railStationService.getRailStation(versionId);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/rail/history/{versionId}")
    public ResponseEntity<List<RailStationLogs>> getRailLogsByVersion(@PathVariable String versionId) {
        logger.info("[getRailLogsByVersion] versionId: {}", versionId);
        try {
            List<RailStationLogs> logs = railStationService.getLogsByVersion(versionId);
            logger.info("[getRailLogsByVersion] getRailLogsByVersion: {}", logs);
            return ResponseEntity.ok(logs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

}
