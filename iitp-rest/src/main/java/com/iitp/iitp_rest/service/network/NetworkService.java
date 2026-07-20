package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.RemoteXmlFetch;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkService {

    private final NetworkJaxbParser networkJaxbParser;
    private final ScenarioRepository scenarioRepository;
    private final ScenarioVersionRepository scenarioVersionRepository;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public NetworkXml getNetworkXmlByVersionId(String versionId) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/network.xml");
        NetworkXml dto = streamToDto(is);
        return transformNetworkCoordinates(versionId, dto);
    }

    public NetworkXml parseAndTransform(String versionId, java.io.InputStream is) {
        NetworkXml networkXml = networkJaxbParser.parse(is);
        return transformNetworkCoordinates(versionId, networkXml, null, null);
    }

    public NetworkXml parseAndTransform(String versionId, java.io.InputStream is, Double latitude, Double longitude) {
        NetworkXml networkXml = networkJaxbParser.parse(is);
        return transformNetworkCoordinates(versionId, networkXml, latitude, longitude);
    }

    public byte[] getRawXmlBytes(String versionId) throws IOException {
        // versionId → 실제 경로 조회 (getNetworkXmlByVersionId와 동일 경로 사용)
        try (InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/network.xml")) {
            return is.readAllBytes();
        }
    }


    public NetworkXml streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        NetworkXml networkDto = networkJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData streamToDto total:{}", totalEnd - totalStart);
        return networkDto;
    }

    /** 좌표 없을 경우 null 반환 (호출부에서 처리) */
    public boolean hasMissingCoordinates(String versionKey) {
        Scenario scenario = scenarioVersionRepository.findByKey(versionKey)
                .map(ScenarioVersion::getScenario)
                .orElseGet(() -> scenarioRepository.findByKey(versionKey).orElse(null));
        return scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null;
    }

    public NetworkXml transformNetworkCoordinates(String versionKey, NetworkXml dto) {
        return transformNetworkCoordinates(versionKey, dto, null, null);
    }

    public NetworkXml transformNetworkCoordinates(String versionKey, NetworkXml dto, Double overrideLatitude, Double overrideLongitude) {
        double baseLatitude;
        double baseLongitude;

        if (overrideLatitude != null && overrideLongitude != null) {
            baseLatitude = overrideLatitude;
            baseLongitude = overrideLongitude;
        } else if (dto.getBaseLat() != null && dto.getBaseLon() != null) {
            // network.xml에 base 좌표가 기록된 경우 최우선 사용 (import 시 origin과 일치 보장)
            baseLatitude  = dto.getBaseLat();
            baseLongitude = dto.getBaseLon();
            log.info("[NetworkService] network.xml base 좌표 사용: lat={}, lon={}", baseLatitude, baseLongitude);
        } else {
            Scenario scenario = scenarioVersionRepository.findByKey(versionKey)
                    .map(ScenarioVersion::getScenario)
                    .orElseGet(() -> scenarioRepository.findByKey(versionKey).orElse(null));

            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                log.warn("[NetworkService] versionKey={}에 대한 시나리오 좌표를 찾을 수 없습니다.", versionKey);
                return dto;
            }
            baseLatitude = scenario.getLatitude();
            baseLongitude = scenario.getLongitude();
        }

        dto.getNodes().forEach(node -> {
            List<Coordinates> transformedNodeCoords = CoordinateUtils.parseAndTransform(
                    node.getCenter(), baseLongitude, baseLatitude
            );
            if (!transformedNodeCoords.isEmpty()) {
                node.setCoordinates(transformedNodeCoords.getFirst());
            }
        });

        dto.getLinks().forEach(link -> {
            link.setCoordinates(CoordinateUtils.parseAndTransform(
                    link.getShape(), baseLongitude, baseLatitude
            ));
        });

        // 커넥션 shape도 동일한 좌표 변환 적용
        dto.getNodes().forEach(node -> {
            if (node.getConnections() == null) return;
            node.getConnections().forEach(conn ->
                conn.setCoordinates(CoordinateUtils.parseAndTransform(
                        conn.getShape(), baseLongitude, baseLatitude
                ))
            );
        });

        return dto;
    }
}