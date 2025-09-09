package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationVersion;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXmlResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.xml.stream.XMLStreamException;
import java.io.InputStream;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class BusStationService {

    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;
    private final BusStationJaxbParser busStationJaxbParser;
    private final RoadService roadService;
    private final ScenarioRepository scenarioRepository;

    public BusStationVersion getByVersionId(String id) {
        return busStationVersionsRepository.findByVersionId(id).orElse(new BusStationVersion());
    }

    public List<BusStationLogs> getLogsByVersion(String id) {
        return busStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveBusStation(BusStationSaveRequest request, String versionId) {
        BusStationVersion entity = busStationVersionsRepository.findByVersionId(versionId)
                .orElse(new BusStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getData());
        busStationVersionsRepository.save(entity);
        List<BusStationLogs> existingLogs = busStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 20;
        if (existingLogs.size() >= maxLogs) {
            int removeCount = existingLogs.size() - maxLogs + 1;
            List<BusStationLogs> toDelete = existingLogs.subList(0, removeCount);
            busStationLogsRepository.deleteAll(toDelete);
        }

        BusStationLogs entityLog = BusStationLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        busStationLogsRepository.save(entityLog);
    }

    public PublicTransitXmlResponse getBusStation(String key) throws XMLStreamException {
        String path = key + "/publicTransit.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        PublicTransitXmlResponse busPublicTransitDto = streamToDto(is);
        return transformBusPublicTransitCoordinates(key, busPublicTransitDto);
    }


    public PublicTransitXmlResponse streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        PublicTransitXmlResponse dto = busStationJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("BusPublicTransitXmlResponse streamToDto total:{}", totalEnd - totalStart);
        return dto;
    }

    public PublicTransitXmlResponse transformBusPublicTransitCoordinates (String key, PublicTransitXmlResponse dto) {
        Scenario scenario = scenarioRepository.findByKey(key).orElse(new Scenario());
        double baseLatitude = scenario.getLatitude();
        double baseLongitude = scenario.getLongitude();

        dto.getBusStations().forEach(busStation -> {
            List<Coordinates> transformedStationCoords = CoordinateUtils.parseAndTransform(
                    busStation.getCenter(), baseLongitude, baseLatitude
            );
            if (!transformedStationCoords.isEmpty()) {
                busStation.setCoordinates(transformedStationCoords.getFirst());
            }
        });

        return dto;
    }
}
