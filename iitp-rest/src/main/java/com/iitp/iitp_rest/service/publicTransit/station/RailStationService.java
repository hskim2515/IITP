package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.network.RoadResponse;
import com.iitp.iitp_rest.model.publicTransit.station.*;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.CoordinateConverter;
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

    public RailPublicTransitData getRailStation(String versionId) throws XMLStreamException {
        final long totalStart = System.nanoTime();
        Scenario scenario = scenarioRepository.findByKey(versionId).orElse(new Scenario());
        final long networkParsingS = System.nanoTime();

        String networkXmlPath = versionId + "/network.xml";
        InputStream networkIs = XmlUtils.loadXmlAsStream(networkXmlPath);
        List<RoadResponse.Road> roadEntities = roadService.streamToDto(networkIs).getRoads();

        final long networkParsingE = System.nanoTime();
        log.info("Station Data getRailStation network parsing: {}", networkParsingE - networkParsingS);

        final long roadMapS = System.nanoTime();
        Map<String, RoadResponse.Road> roadMap = roadEntities.stream().collect(Collectors.toMap(
                road -> road.getLinkId() + "|" + road.getLaneId(),
                Function.identity(),
                (r1, r2) -> r1
        ));
        final long roadMapE = System.nanoTime();
        log.info("Station Data getRailStation roadMap : {}", roadMapE - roadMapS);
        final long CoordinateConverterS = System.nanoTime();
        // --- 3. CoordinateConverter 캐시 생성 ---
        Map<String, CoordinateConverter> converterCache = new ConcurrentHashMap<>();
        roadMap.forEach((key, road) -> {
            CoordinateConverter converter = new CoordinateConverter();
            converter.setBasePoint(scenario.getLongitude(), scenario.getLatitude());
            converter.setRoadPoint(road.getBaseEasting(), road.getBaseNorthing(), road.getTargetEasting(), road.getTargetNorthing());
            converterCache.put(key, converter);
        });
        final long CoordinateConverterE = System.nanoTime();
        log.info("Station Data getRailStation CoordinateConverter : {}", CoordinateConverterE - CoordinateConverterS);

        final long stationParsingS = System.nanoTime();

        // --- 4. 철도 정류장 정보 파싱 ---
        String railPublicTransitXmlPath = versionId + "/railPublicTransit.xml";
        InputStream is = XmlUtils.loadXmlAsStream(railPublicTransitXmlPath);
        RailPublicTransitData result = railStationXmlParser.parse(is);
        final long stationParsingE = System.nanoTime();
        log.info("Station Data getRailStation station parsing: {}", stationParsingE - stationParsingS);
        final long convertS = System.nanoTime();

        // --- 5. 파싱된 각 철도 정류장의 상대좌표를 절대좌표로 변환 ---
        if (result.getRailStations() != null) {
//            for (RailStationData station : result.getRailStations()) {
//                // 도로 ID와 차선 ID로 Key 생성
//                String key = station.getLinkRef() + "|" + station.getLaneRef();
//                CoordinateConverter converter = converterCache.get(key);
//
//                // 해당 도로 정보가 없으면 변환 불가
//                if (converter == null) {
//                    continue;
//                }
//
//                // 버스 정류장의 offset(pos)은 도로 시작점에서의 거리(1D)이므로,
//                // toAbsolute 메서드의 첫 번째 인자(posX)로 사용합니다. posY는 0으로 가정합니다.
//                double posX = station.getPos(); // 또는 getPos()
//                double posY = 0.0; // 차선 중심에 위치한다고 가정
//
//                ProjCoordinate actualCoord = converter.toAbsolute(posX, posY);
//
//                // 변환된 절대좌표를 DTO의 coordinates 필드에 추가
//                BusStationData.Coordinates newCoord = new BusStationData.Coordinates();
//                newCoord.setLat(actualCoord.y); // ProjCoordinate의 y가 위도(lat)
//                newCoord.setLng(actualCoord.x); // ProjCoordinate의 x가 경도(lng)
//                station.getCoordinates().add(newCoord);
//            }
        }
        final long convertE = System.nanoTime();
        log.info("Station Data getBusStation station convert: {}", convertE - convertS);
        final long totalEnd = System.nanoTime();
        log.info("Station Data getBusStation station total: {}", totalEnd - totalStart);
        return result;
    }
}
