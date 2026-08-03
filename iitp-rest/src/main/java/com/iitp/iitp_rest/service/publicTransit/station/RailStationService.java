package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.rail.ExitData;
import com.iitp.iitp_rest.model.publicTransit.rail.ExitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationData;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationLogs;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationVersion;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationXml;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.iitp.iitp_rest.util.RemoteXmlFetch;

import java.io.ByteArrayInputStream;
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
    private final RailStationMapper railStationMapper;
    private final RoadService roadService;
    private final FileStorageService fileStorage;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public RailStationVersion getByVersionId(String id) {
        // ⚠️ findByVersionId(role 미지정)가 아니라 반드시 이걸 써야 한다 — BusStationService와
        // 동일 이유(2026-08-03 실측, database/bus_rail_signal_versions_constraint_fix.sql 참고).
        return railStationVersionsRepository.findByVersionIdAndVersionRole(id, BaseVersion.VersionRole.LATEST)
                .orElse(new RailStationVersion());
    }

    public List<RailStationLogs> getLogsByVersion(String id) {
        return railStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveRailStationByVersionId(RailStationSaveRequest request, String versionId) {
        RailStationVersion entity = railStationVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST)
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

        // DB 저장과 동시에 실제 railStation.xml 파일도 SFTP에 동기화한다(BusStationService와
        // 동일 패턴). 이게 없으면 지금까지처럼 import(파일 업로드)로만 실제 SFTP 파일이 생성되고,
        // 앱의 일반 저장 경로는 DB 캐시에만 반영돼 NextSim 실행(railStation.xml)에 전혀
        // 반영되지 않는다.
        try {
            RailPublicTransitXml xml = toRailPublicTransitXmlFromData(request.getData());
            byte[] xmlBytes = railStationJaxbParser.marshal(xml);
            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "railStation.xml");
            log.info("[RailStationService] railStation.xml 저장 완료: {}/railStation.xml", versionId);
        } catch (Exception e) {
            log.warn("[RailStationService] railStation.xml 파일 동기화 실패(DB는 정상 저장됨): {}", e.getMessage());
        }
    }

    /** List&lt;RailStationData&gt;(프론트 저장 요청) → RailPublicTransitXml.
     *  NextSim 실제 배포판 예시는 address 가 아니라 name 속성을 사용하므로 변환 시 채워준다. */
    private RailPublicTransitXml toRailPublicTransitXmlFromData(List<RailStationData> stations) {
        List<RailStationXml> xmlStations = (stations == null ? List.<RailStationData>of() : stations).stream().map(d -> {
            RailStationXml x = new RailStationXml();
            try { x.setId(Long.parseLong(d.getId())); } catch (Exception ignore) {}
            if (d.getTransitMode() != null) x.setTransitMode(com.iitp.iitp_rest.model.publicTransit.TransitMode.fromValue(d.getTransitMode()));
            x.setLineList(d.getLineList() == null ? null : String.join(" ", d.getLineList()));
            x.setAddress(d.getAddress());
            x.setName(d.getAddress());
            x.setCenter(d.getCenter());
            x.setExits(d.getExits() == null ? new java.util.ArrayList<>() : d.getExits().stream().map(e -> {
                ExitXml ex = new ExitXml();
                try { ex.setId(Long.parseLong(e.getId())); } catch (Exception ignore) {}
                ex.setLinkRef((long) e.getLinkRef());
                ex.setOffset(e.getOffset());
                ex.setAccessTime(e.getAccessTime());
                ex.setCoord(e.getCoord());
                return ex;
            }).collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new)));
            return x;
        }).toList();
        RailPublicTransitXml xml = new RailPublicTransitXml();
        xml.setRailStations(xmlStations);
        return xml;
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

    /** railStation.xml 업로드 → 파싱(좌표 변환 포함) + DB 저장 + SFTP 동기화 */
    @Transactional
    public RailPublicTransitResponse importFromXml(byte[] xmlBytes, String versionId) throws Exception {
        RailPublicTransitXml xml = streamToDto(new ByteArrayInputStream(xmlBytes));
        xml = transformRailPublicTransitCoordinates(versionId, xml);
        RailPublicTransitResponse response = railStationMapper.toResponse(xml);

        RailStationSaveRequest request = new RailStationSaveRequest();
        request.setData(toDataList(response.getRailStations()));
        request.setLogs(new com.iitp.iitp_rest.model.LogsData());
        saveRailStationByVersionId(request, versionId);

        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "railStation.xml");
        return response;
    }

    /**
     * List&lt;RailStationResponse&gt; → List&lt;RailStationData&gt; (XML 임포트 → DB 저장용).
     * lineList는 응답에서 공백 구분 원본 문자열(XML lineList 속성 그대로) → 토큰 리스트로 분해.
     * exits는 문자열/숫자 필드 타입이 갈라져 있어(offset/accessTime: String↔double 등) 개별 파싱.
     */
    public List<RailStationData> toDataList(List<RailStationResponse> responses) {
        return responses.stream().map(r -> RailStationData.builder()
                .id(r.getId())
                .transitMode(r.getTransitMode() != null ? r.getTransitMode().getValue() : null)
                .address(r.getAddress())
                .center(r.getCenter())
                .coordinates(r.getCoordinates())
                .lineList(r.getLineList() == null || r.getLineList().isBlank()
                        ? new java.util.ArrayList<>()
                        : new java.util.ArrayList<>(java.util.Arrays.asList(r.getLineList().trim().split("\\s+"))))
                .exits(r.getExits() == null ? new java.util.ArrayList<>() : r.getExits().stream().map(e ->
                        ExitData.builder()
                                .id(e.getId())
                                .linkRef(parseIntSafe(e.getLinkRef()))
                                .offset(e.getOffset() != null ? e.getOffset() : 0.0)
                                .accessTime(parseDoubleSafe(e.getAccessTime()))
                                .coord(e.getCoord())
                                .build()
                ).collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new)))
                .build()
        ).toList();
    }

    private static int parseIntSafe(String s) {
        try { return s != null ? Integer.parseInt(s.trim()) : 0; } catch (NumberFormatException e) { return 0; }
    }

    private static double parseDoubleSafe(String s) {
        try { return s != null ? Double.parseDouble(s.trim()) : 0.0; } catch (NumberFormatException e) { return 0.0; }
    }

    public RailPublicTransitXml transformRailPublicTransitCoordinates(String versionKey, RailPublicTransitXml dto) {
        Scenario scenario = scenarioVersionRepository.findByKey(versionKey)
                .map(ScenarioVersion::toEffectiveScenario)
                .orElseGet(() -> scenarioRepository.findByKey(versionKey).orElse(null));

        if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
            log.warn("[RailStationService] versionKey={}에 대한 시나리오 좌표를 찾을 수 없어 좌표 변환을 건너뜁니다.", versionKey);
            return dto;
        }

        double baseLatitude = scenario.getLatitude();
        double baseLongitude = scenario.getLongitude();
        double rotationRad = Math.toRadians(scenario.getBaseRotation() != null ? scenario.getBaseRotation() : 0.0);
        double scale = scenario.getBaseScale() != null ? scenario.getBaseScale() : 1.0;

        dto.getRailStations().forEach(railStation -> {
            List<Coordinates> transformedStationCoords = CoordinateUtils.parseAndTransform(
                    railStation.getCenter(), baseLongitude, baseLatitude, rotationRad, scale
            );
            if (!transformedStationCoords.isEmpty()) {
                railStation.setCoordinates(transformedStationCoords.getFirst());
            }
        });

        return dto;
    }


}
