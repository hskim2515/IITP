package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
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
@RequestMapping("/public-transit/station/rail")
@Slf4j
public class RailStationController {

    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final RailStationService railStationService;
    private final RailStationMapper railStationMapper;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<RailPublicTransitResponse> getRailStationsByScenarioKey(@PathVariable String scenarioKey) {
        logger.info("[getRailStationsByScenarioKey] scenarioKey: {}", scenarioKey);

        RailPublicTransitXml xml = railStationService.getRailStationXmlByScenarioKey(scenarioKey);
        RailPublicTransitResponse body = railStationMapper.toResponse(xml);
        return ResponseEntity.ok(body);
    }
}
