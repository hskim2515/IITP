package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.station.*;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
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
import org.w3c.dom.Node;
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
    private final RailStationService railStationService;

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

                String transitMode = nodeElement.getAttribute("transitMode");

                if (!"bus".equalsIgnoreCase(transitMode)) {
                    continue; // bus가 아닌 경우는 건너뜀
                }

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


    @GetMapping("/rail/{versionId}")
    public ResponseEntity<RailPublicTransitData> getRailStation(@PathVariable String versionId) {
        RailPublicTransitData result = new RailPublicTransitData();
        List<RailStationData> stations = new ArrayList<>();

        try (InputStream is = getClass().getClassLoader().getResourceAsStream(versionId + "/railPublicTransit.xml")) {
            if (is == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }

            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            NodeList stationNodes = doc.getElementsByTagName("railStation");

            for (int i = 0; i < stationNodes.getLength(); i++) {
                Element stationElement = (Element) stationNodes.item(i);

                if (!"subway".equalsIgnoreCase(stationElement.getAttribute("transitMode"))) {
                    continue;
                }

                // 좌표 처리
                RailStationData.Coordinates coord = new RailStationData.Coordinates();
                try {
                    coord.setLat(Double.parseDouble(stationElement.getAttribute("lat")));
                    coord.setLng(Double.parseDouble(stationElement.getAttribute("lng")));
                } catch (NumberFormatException e) {
                    coord.setLat(null);
                    coord.setLng(null);
                }

                RailStationData station = RailStationData.builder()
                        .id(stationElement.getAttribute("id"))
                        .transitMode(stationElement.getAttribute("transitMode"))
                        .address(stationElement.getAttribute("address"))
                        .coordinates(List.of(coord))
                        .exits(new ArrayList<>())
                        .build();

                // 자식 exit 파싱
                NodeList exitNodes = stationElement.getElementsByTagName("exit");
                for (int j = 0; j < exitNodes.getLength(); j++) {
                    Element exitElement = (Element) exitNodes.item(j);

                    ExitData.Coordinates exitCoord = new ExitData.Coordinates();
                    try {
                        exitCoord.setLat(Double.parseDouble(exitElement.getAttribute("lat")));
                        exitCoord.setLng(Double.parseDouble(exitElement.getAttribute("lng")));
                    } catch (NumberFormatException e) {
                        exitCoord.setLat(null);
                        exitCoord.setLng(null);
                    }

                    ExitData exit = ExitData.builder()
                            .id(exitElement.getAttribute("id"))
                            .linkRef(parseIntSafe(exitElement.getAttribute("linkRef")))
                            .offset(parseDoubleSafe(exitElement.getAttribute("offset")))
                            .accessTime(parseDoubleSafe(exitElement.getAttribute("accessTime")))
                            .coordinates(List.of(exitCoord))
                            .build();

                    station.getExits().add(exit);
                }

                stations.add(station);
            }

            result.setRailStations(stations);
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
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
//
//    @PostMapping("/rail/{versionId}")
//    public ResponseEntity<Void> saveRailStation (@RequestBody RailStationSaveRequest request, @PathVariable String versionId) {
//        logger.info("[saveBusStation] request: {}", request);
//        try {
//            railStationService.saveRailStation(request, versionId);
//            return ResponseEntity.ok().build();
//        } catch (Exception e) {
//            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
//        }
//    }

}
