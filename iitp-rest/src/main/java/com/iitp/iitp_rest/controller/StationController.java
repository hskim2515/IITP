package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.station.*;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.stream.XMLStreamException;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
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
    public ResponseEntity<PublicTransitData> getBusStation(@PathVariable String versionId) throws XMLStreamException, IOException {
        logger.info("[getBusStation] versionId: {}", versionId);

        PublicTransitData result = busStationService.getBusStation(versionId);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/bus/history/{versionId}")
    public ResponseEntity<List<BusStationLogs>> getLogsByVersion(@PathVariable String versionId) {
        logger.info("[getLogsByVersion] versionId: {}", versionId);
        try{
            List<BusStationLogs> logs = busStationService.getLogsByVersion(versionId);
            logger.info("[getLogsByVersion] getLogsByVersion: {}", logs);
            return ResponseEntity.ok(logs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/bus/{versionId}")
    public ResponseEntity<Void> saveBusStation (@RequestBody BusStationSaveRequest request, @PathVariable String versionId) {
        logger.info("[saveBusStation] request: {}", request);
        try {
            busStationService.saveBusStation(request, versionId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }


    @GetMapping("/rail/{versionId}")
    public ResponseEntity<RailPublicTransitData> getRailStation(@PathVariable String versionId) throws XMLStreamException {
        logger.info("[getRailStation] versionId: {}", versionId);

        RailPublicTransitData result = railStationService.getRailStation(versionId);
        return ResponseEntity.ok(result);
    }

    // 안전한 Integer 파싱 (널/빈 문자열 대응)
    private Integer parseIntSafe(String value) {
        try {
            return (value != null && !value.isEmpty()) ? Integer.parseInt(value) : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // 안전한 Double 파싱 (널/빈 문자열 대응)
    private Double parseDoubleSafe(String value) {
        try {
            return (value != null && !value.isEmpty()) ? Double.parseDouble(value) : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    @GetMapping("/rail/history/{versionId}")
    public ResponseEntity<List<RailStationLogs>> getRailLogsByVersion(@PathVariable String versionId) {
        logger.info("[getRailLogsByVersion] versionId: {}", versionId);
        try{
            List<RailStationLogs> logs = railStationService.getLogsByVersion(versionId);
            logger.info("[getRailLogsByVersion] getRailLogsByVersion: {}", logs);
            return ResponseEntity.ok(logs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

}
