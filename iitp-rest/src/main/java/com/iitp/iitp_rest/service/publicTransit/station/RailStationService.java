package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXmlResponse;
import com.iitp.iitp_rest.model.network.RoadResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.*;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.xml.stream.XMLStreamException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class RailStationService {

    private final ScenarioRepository scenarioRepository;
    private final RailStationVersionsRepository railStationVersionsRepository;
    private final RailStationLogsRepository railStationLogsRepository;
    private final RailStationXmlParser railStationXmlParser;
    private final RailStationJaxbParser railStationJaxbParser;
    private final RoadService roadService;

    public RailStationVersion getByVersionId(String id) {
        return railStationVersionsRepository.findByVersionId(id).orElse(new RailStationVersion());
    }

    public List<RailStationLogs> getLogsByVersion(String id) {
        return railStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveRailStation(RailStationSaveRequest request, String versionId) {
        RailStationVersion entity = railStationVersionsRepository.findByVersionId(versionId)
                .orElse(new RailStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getData());
        railStationVersionsRepository.save(entity);
        List<RailStationLogs> existingLogs = railStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 20;
        if (existingLogs.size() >= maxLogs) {
            int removeCount = existingLogs.size() - maxLogs + 1;
            List<RailStationLogs> toDelete = existingLogs.subList(0, removeCount);
            railStationLogsRepository.deleteAll(toDelete);
        }

        RailStationLogs entityLog = RailStationLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        railStationLogsRepository.save(entityLog);
    }

    public RailPublicTransitXmlResponse getRailStation(String key) throws XMLStreamException {
        String path = key + "/railPublicTransit.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        RailPublicTransitXmlResponse railPublicTransitDto = streamToDto(is);
        return transformRailPublicTransitCoordinates(key, railPublicTransitDto);
    }

    public RailPublicTransitXmlResponse streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        RailPublicTransitXmlResponse dto = railStationJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("RailPublicTransitXmlResponse streamToDto total:{}", totalEnd - totalStart);
        return dto;
    }

    public RailPublicTransitXmlResponse transformRailPublicTransitCoordinates(String key, RailPublicTransitXmlResponse dto) {
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
