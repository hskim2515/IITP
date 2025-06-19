package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.publicTransit.station.StationEntity;
import com.iitp.iitp_rest.service.publicTransit.station.StationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;


@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station")
@Slf4j
public class StationController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final StationService stationService;

//    @GetMapping("/bus")
//    public ResponseEntity<List<StationEntity>> getAllBusStations() {
//        return ResponseEntity.ok(stationService.getAllStations());
//    }

    @GetMapping("/bus/{key}")
//    public ResponseEntity<StationEntity> getBusStation(@PathVariable Long id) {
    public ResponseEntity<StationEntity> getBusStation() {
        return ResponseEntity.ok(stationService.getStation(2L));
    }

    @PostMapping("/bus/{id}")
    public ResponseEntity<Void> saveBusStation(@RequestBody StationEntity entity, @PathVariable("id") Long id) {
        logger.info("[saveBusStation] entity: {}", entity);
        stationService.saveBusStation(entity, id);
        return ResponseEntity.ok().build();
    }

}
