package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RailStationService {

    private final ScenarioRepository scenarioRepository;
    private final RailStationJaxbParser railStationJaxbParser;


    public RailPublicTransitXml getRailStationXmlByScenarioKey(String scenarioKey) {
        String path = scenarioKey + "/railPublicTransit.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        RailPublicTransitXml railPublicTransitDto = streamToDto(is);
        return transformRailPublicTransitCoordinates(scenarioKey, railPublicTransitDto);
    }

    public RailPublicTransitXml streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        RailPublicTransitXml dto = railStationJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("RailPublicTransitXmlResponse streamToDto total:{}", totalEnd - totalStart);
        return dto;
    }

    public RailPublicTransitXml transformRailPublicTransitCoordinates(String key, RailPublicTransitXml dto) {
        Scenario scenario = scenarioRepository.findByKey(key).orElse(new Scenario());
        double baseLatitude = scenario.getLatitude();
        double baseLongitude = scenario.getLongitude();

        dto.getRailStations().forEach(railStation -> {
            List<Coordinates> transformedStationCoords = CoordinateUtils.parseAndTransform(
                    railStation.getCenter(), baseLongitude, baseLatitude
            );
            if (!transformedStationCoords.isEmpty()) {
                railStation.setCoordinates(transformedStationCoords.getFirst());
            }
            railStation.getExits().forEach(exit -> {
                List<Coordinates> coordinates = CoordinateUtils.parseAndTransform(
                        exit.getCoord(), baseLongitude, baseLatitude
                );
                exit.setCoordinates(coordinates.getFirst());
            });
        });

        return dto;
    }


}
