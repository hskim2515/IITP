package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationVersion;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RailStationService {

    private final ScenarioRepository scenarioRepository;
    private final RailStationVersionsRepository railStationVersionsRepository;
    private final RailStationLogsRepository railStationLogsRepository;
    private final RailStationJaxbParser railStationJaxbParser;
    private final RoadService roadService;

    public RailStationVersion getByVersionId(String id) {
        return railStationVersionsRepository.findByVersionId(id).orElse(new RailStationVersion());
    }

    public List<RailStationLogs> getLogsByVersion(String id) {
        return railStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveRailStationByVersionId(RailStationSaveRequest request, String versionId) {
        RailStationVersion entity = railStationVersionsRepository.findByVersionId(versionId)
                .orElse(new RailStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getData());
        railStationVersionsRepository.save(entity);
        List<RailStationLogs> existingLogs = railStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 10;
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

    public RailPublicTransitXml getRailStationXmlByVersionId(String versionId) {
        String path = versionId + "/railPublicTransit.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        RailPublicTransitXml railPublicTransitDto = streamToDto(is);
        return transformRailPublicTransitCoordinates(versionId, railPublicTransitDto);
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
        });

        return dto;
    }


}
