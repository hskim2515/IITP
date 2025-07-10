package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationData;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.station.PublicTransitData;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import com.iitp.iitp_rest.service.publicTransit.station.StationService;
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
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;


@RestController
@RequiredArgsConstructor
@RequestMapping("/public-transit/station")
@Slf4j
public class StationController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final StationService stationService;
    private final BusStationService busStationService;

//    @GetMapping("/bus")
//    public ResponseEntity<List<StationEntity>> getAllBusStations() {
//        return ResponseEntity.ok(stationService.getAllStations());
//    }
//
//    @GetMapping("/bus/{key}")
////    public ResponseEntity<StationEntity> getBusStation(@PathVariable Long id) {
//    public ResponseEntity<StationEntity> getBusStation() {
//        return ResponseEntity.ok(stationService.getStation(2L));
//    }

    @GetMapping("/bus/{versionId}")
    public ResponseEntity<PublicTransitData> getBusStation(@PathVariable String versionId) {
        PublicTransitData result = new PublicTransitData();
        List<BusStationData> stations = new ArrayList<>();

        try (InputStream is = getClass().getClassLoader().getResourceAsStream(versionId + "/publicTransit.xml")) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            // stations
            NodeList nodeList = doc.getElementsByTagName("station");
            for (int i = 0; i < nodeList.getLength(); i++) {
                Element nodeElement = (Element) nodeList.item(i);

                BusStationData.Coordinates coord = new BusStationData.Coordinates();
                coord.setLat(Double.valueOf(nodeElement.getAttribute("lat")));
                coord.setLng(Double.valueOf(nodeElement.getAttribute("lng")));

                BusStationData station = BusStationData.builder()
                        .id(nodeElement.getAttribute("id"))
                        .transitMode(nodeElement.getAttribute("transitMode"))
                        .linkRef(Integer.valueOf(nodeElement.getAttribute("linkRef")))
                        .laneRef(Integer.valueOf(nodeElement.getAttribute("laneRef")))
                        .offset(Double.valueOf(nodeElement.getAttribute("offset")))
                        .type(nodeElement.getAttribute("type"))
                        .address(nodeElement.getAttribute("address"))
                        .coordinates(List.of(coord))
                        .build();

                stations.add(station);
            }
            result.setBusStations(stations);
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
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

}
