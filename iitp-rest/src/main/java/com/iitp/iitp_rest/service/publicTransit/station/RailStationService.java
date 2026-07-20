package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationVersion;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.CoordinateUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.iitp.iitp_rest.util.RemoteXmlFetch;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RailStationService {

    private final ScenarioRepository scenarioRepository;
    private final ScenarioVersionRepository scenarioVersionRepository;
    private final RailStationVersionsRepository railStationVersionsRepository;
    private final RailStationLogsRepository railStationLogsRepository;
    private final RailStationJaxbParser railStationJaxbParser;
    private final RoadService roadService;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public RailStationVersion getByVersionId(String id) {
        return railStationVersionsRepository.findByVersionId(id).orElse(new RailStationVersion());
    }

    public List<RailStationLogs> getLogsByVersion(String id) {
        return railStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveRailStationByVersionId(RailStationSaveRequest request, String versionId) {
        RailStationVersion entity = railStationVersionsRepository.findByVersionId(versionId)
                .orElseGet(() -> {
                    RailStationVersion v = new RailStationVersion();
                    v.setVersionRole(BaseVersion.VersionRole.LATEST);
                    return v;
                });
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

    public RailPublicTransitXml getRailStationXmlByVersionId(String versionId) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/railStation.xml");
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

    public byte[] exportAsXml(String versionId) throws Exception {
        // coordinates는 @XmlTransient이므로 원본 XML 그대로 재직렬화
        RailPublicTransitXml xml = getRailStationXmlByVersionId(versionId);
        return railStationJaxbParser.marshal(xml);
    }

    public RailPublicTransitXml transformRailPublicTransitCoordinates(String versionKey, RailPublicTransitXml dto) {
        Scenario scenario = scenarioVersionRepository.findByKey(versionKey)
                .map(ScenarioVersion::getScenario)
                .orElseGet(() -> scenarioRepository.findByKey(versionKey).orElse(null));

        if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
            log.warn("[RailStationService] versionKey={}에 대한 시나리오 좌표를 찾을 수 없어 좌표 변환을 건너뜁니다.", versionKey);
            return dto;
        }

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
