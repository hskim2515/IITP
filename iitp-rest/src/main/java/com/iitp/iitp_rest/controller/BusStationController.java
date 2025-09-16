package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.publicTransit.BusStationMapper;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXml;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station/bus")
@Slf4j
public class BusStationController {

    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final BusStationService busStationService;
    private final BusStationMapper busStationMapper;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<PublicTransitResponse> getBusStationsByScenarioKey(@PathVariable String scenarioKey) {
        logger.info("[getBusStationsByScenarioKey] scenarioKey: {}", scenarioKey);

        PublicTransitXml xml = busStationService.getBusStationXmlByScenarioKey(scenarioKey);
        PublicTransitResponse body = busStationMapper.toResponse(xml);
        return ResponseEntity.ok(body);
    }
}
