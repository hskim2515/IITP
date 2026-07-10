package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.*;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.road.RoadResponse;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.vehicle.route.VehicleRequest;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.signal.SignalTimelineResponse;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.util.FileStorageService;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.signal.SignalTimelineService;
import com.iitp.iitp_rest.service.vehicle.DummySignalGenerator;
import com.iitp.iitp_rest.service.vehicle.DummyVehicleGenerator;
import com.iitp.iitp_rest.service.vehicle.VehicleRouteService;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.GeoJsonUtils;
import com.iitp.iitp_rest.util.VehicleDataReader;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import javax.xml.parsers.DocumentBuilderFactory;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/vehicle")
@RequiredArgsConstructor
public class VehicleController {

    private static final Logger logger = LoggerFactory.getLogger(VehicleController.class);

    private final VehicleDataReader vehicleDataReader;
    private final ScenarioService scenarioService;
    private final VehicleRouteService vehicleRouteService;
    private final SignalTimelineService signalTimelineService;
    private final NetworkService networkService;
    private final NetworkTileService networkTileService;
    private final DummyVehicleGenerator dummyVehicleGenerator;
    private final DummySignalGenerator dummySignalGenerator;
    private final FileStorageService fileStorage;

    /** 현재 비동기 생성 중인 scenarioKey 집합 */
    private final java.util.concurrent.ConcurrentHashMap<String, Boolean> generatingSet = new java.util.concurrent.ConcurrentHashMap<>();
    /** 마지막 생성 실패 메시지 (scenarioKey → 에러메시지) */
    private final java.util.concurrent.ConcurrentHashMap<String, String> failedSet = new java.util.concurrent.ConcurrentHashMap<>();
    /** 현재 생성 단계 메시지 (scenarioKey → 단계 설명) */
    private final java.util.concurrent.ConcurrentHashMap<String, String> stageMap = new java.util.concurrent.ConcurrentHashMap<>();
    /** 생성 시작 시각 (scenarioKey → System.currentTimeMillis()) */
    private final java.util.concurrent.ConcurrentHashMap<String, Long> startTimeMap = new java.util.concurrent.ConcurrentHashMap<>();

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    /** in-memory 더미 생성 한계 — 초과 시 SQLite 스트리밍 생성으로 전환 (이벤트 List 미보유) */
    private static final int LARGE_DUMMY_THRESHOLD = 10_000;
    /** 이벤트가 이보다 많으면 전체 CZML 빌드 생략(heap 보호) — viewport 스트리밍이 서빙 */
    private static final long LARGE_EVENT_THRESHOLD = 5_000_000L;

    @PostMapping("/generate-vehicle-route/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> generateVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) throws IOException {

        Scenario scenario = scenarioService.getScenarioByKey(scenarioKey);

        if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
            logger.error("[generateVehicleRoute] scenarioKey={}의 기준 좌표(latitude/longitude)가 설정되지 않았습니다.", scenarioKey);
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(Map.of("error", "시나리오 기준 좌표(latitude/longitude)가 설정되지 않았습니다: " + scenarioKey));
        }

        String networkXmlUrl = remoteUrl + scenarioKey + "/network.xml";
        logger.info("[generateVehicleRoute] scenarioKey={}, networkXmlUrl={}", scenarioKey, networkXmlUrl);

        // [PERF] network.xml 원격 다운로드 (openStream은 lazy → 전체 바이트를 먼저 받아 시간 분리 측정)
        stageMap.put(scenarioKey, "네트워크 XML 다운로드 중...");
        long _tDl = System.currentTimeMillis();
        byte[] networkBytes;
        try (InputStream raw = new URL(networkXmlUrl).openStream()) {
            networkBytes = raw.readAllBytes();
        } catch (java.io.FileNotFoundException e) {
            logger.warn("[generateVehicleRoute] network.xml 없음: {}", networkXmlUrl);
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "network.xml 파일이 없습니다. 네트워크를 먼저 저장하세요: " + scenarioKey));
        }
        logger.info("[PERF] network.xml 다운로드: {}ms, {}KB", System.currentTimeMillis() - _tDl, networkBytes.length / 1024);
        InputStream is = new ByteArrayInputStream(networkBytes);

        stageMap.put(scenarioKey, "네트워크 XML 파싱 중...");
        long _tParse = System.currentTimeMillis();
        List<RoadResponse.Road> roadEntities = GeoJsonUtils.parseXmlToRoads(is);
        logger.info("[PERF] parseXmlToRoads: {}ms, {} roads", System.currentTimeMillis() - _tParse, roadEntities.size());

        // pos_x/pos_y가 링크 기준 좌표계이므로 linkId로만 키잉
        Map<String, RoadResponse.Road> roadMap = roadEntities.stream().collect(Collectors.toMap(
                RoadResponse.Road::getLinkId,
                Function.identity(),
                (r1, r2) -> r1
        ));

        // CoordinateConverter 사전 생성
        long _tConv = System.currentTimeMillis();
        Map<String, CoordinateConverter> converterCache = new ConcurrentHashMap<>();
        roadMap.forEach((key, road) -> {
            CoordinateConverter converter = new CoordinateConverter();
            converter.setBasePoint(scenario.getLongitude(), scenario.getLatitude());
            converter.setRoadPoint(road.getBaseEasting(), road.getBaseNorthing(), road.getTargetEasting(), road.getTargetNorthing(), road.getHalfWidth());
            converterCache.put(key, converter);
        });
        logger.info("[PERF] CoordinateConverter 생성: {}ms, {} converters", System.currentTimeMillis() - _tConv, converterCache.size());

        stageMap.put(scenarioKey, "시뮬레이션 데이터 확인 중...");
        // 대용량 가드: 이벤트 수천만 건을 전부 로드해 CZML 을 빌드하면 heap OOM.
        // 대용량 DB 는 전체 CZML 을 만들지 않고 viewport 스트리밍이 서빙한다.
        long existingEvents = vehicleDataReader.countEvents(scenarioKey);
        if (existingEvents > LARGE_EVENT_THRESHOLD) {
            logger.info("[generateVehicleRoute] {} 대용량 DB (이벤트 {}건) — 전체 CZML 생략, viewport 스트리밍 사용", scenarioKey, existingEvents);
            stageMap.remove(scenarioKey);
            return ResponseEntity.ok(Map.of("status", "ok", "largeMode", true, "events", existingEvents));
        }

        stageMap.put(scenarioKey, "시뮬레이션 데이터 로드 중...");
        long _tRead = System.currentTimeMillis();
        List<VehicleEvent> vehicleEvents = existingEvents > 0
                ? vehicleDataReader.readVehicleEvent(scenarioKey)
                : new ArrayList<>();
        logger.info("[PERF] readVehicleEvent: {}ms, {} events", System.currentTimeMillis() - _tRead, vehicleEvents.size());
        if (vehicleEvents.isEmpty()) {
            // 더미 생성은 명시적 요청(generateDummy=true)일 때만 — 로드 경로 POST가 더미를 만들지 않도록
            if (!request.isGenerateDummy()) {
                logger.info("[generateVehicleRoute] {} vehicle_sim.db 없음 — 명시적 생성 요청이 아니므로 더미 생성 안 함", scenarioKey);
                throw new java.io.FileNotFoundException("시뮬레이션 결과 파일(vehicle_sim.db)이 없습니다: " + scenarioKey);
            }
            logger.info("[generateVehicleRoute] {} vehicle_sim.db 없음 — 네트워크 기반 더미 데이터 생성 후 SFTP 저장", scenarioKey);
            try {
                NetworkXml networkXml = networkService.getNetworkXmlByVersionId(scenarioKey);
                int numVehicles;
                if (request.getNumVehicle() > 0) {
                    numVehicles = request.getNumVehicle();
                } else {
                    // 도로 총 연장(km) 기반 자동 계산: 15대/km
                    double totalLengthM = roadMap.values().stream()
                            .filter(r -> r.getBaseEasting() != null && r.getTargetEasting() != null)
                            .mapToDouble(r -> {
                                double dx = r.getTargetEasting() - r.getBaseEasting();
                                double dy = r.getTargetNorthing() - r.getBaseNorthing();
                                return Math.sqrt(dx * dx + dy * dy);
                            })
                            .sum();
                    numVehicles = Math.max(50, (int) (totalLengthM / 1000.0 * 15.0));
                    logger.info("[generateVehicleRoute] {} 면적 기반 차량 수 자동 계산: 도로 연장 {}km → {}대",
                            scenarioKey, String.format("%.1f", totalLengthM / 1000.0), numVehicles);
                }

                DummyVehicleGenerator.SignalContext signalCtx =
                        buildSignalContext(networkXml, remoteUrl + scenarioKey + "/signal.xml");

                // ── 대량(전국급): 이벤트를 메모리에 안 들고 SQLite 로 직접 스트리밍 생성 ──
                // (in-memory 는 186K대=4,800만 건에서 OOM 실측. 전체 CZML 도 생략 → viewport 가 서빙)
                if (numVehicles > LARGE_DUMMY_THRESHOLD) {
                    stageMap.put(scenarioKey, "대량 더미 생성 중... (차량 " + numVehicles + "대, 스트리밍)");
                    DummyVehicleGenerator.StreamGenResult gen = dummyVehicleGenerator.generateToSqlite(
                            networkXml, roadMap, numVehicles, 600, 42L, signalCtx,
                            done -> stageMap.put(scenarioKey, "대량 더미 생성 중... (" + done + "/" + numVehicles + "대)"));
                    stageMap.put(scenarioKey, "서버 업로드 중... (이벤트 " + gen.eventCount() + "건)");
                    try (InputStream dbStream = new FileInputStream(gen.dbFile())) {
                        fileStorage.uploadFile(dbStream, scenarioKey, "vehicle_sim.db");
                    } finally {
                        gen.dbFile().delete();
                    }
                    vehicleDataReader.invalidateDbCache(scenarioKey);
                    viewportCtxCache.remove(scenarioKey);
                    logger.info("[generateVehicleRoute] {} 대량 더미 업로드 완료 ({}대, {}건) — viewport 스트리밍 사용", scenarioKey, numVehicles, gen.eventCount());
                    stageMap.remove(scenarioKey);
                    return ResponseEntity.ok(Map.of("status", "ok", "largeMode", true,
                            "vehicles", numVehicles, "events", gen.eventCount()));
                }

                stageMap.put(scenarioKey, "더미 차량 경로 생성 중... (차량 " + numVehicles + "대)");
                vehicleEvents = dummyVehicleGenerator.generate(networkXml, roadMap, numVehicles, 600, 42L, signalCtx);
                if (!vehicleEvents.isEmpty()) {
                    stageMap.put(scenarioKey, "SQLite 파일 생성 및 서버 업로드 중... (이벤트 " + vehicleEvents.size() + "건)");
                    try (java.io.InputStream dbStream = dummyVehicleGenerator.writeToSqlite(vehicleEvents)) {
                        fileStorage.uploadFile(dbStream, scenarioKey, "vehicle_sim.db");
                        logger.info("[generateVehicleRoute] {} vehicle_sim.db SFTP 업로드 완료", scenarioKey);
                    }
                    vehicleDataReader.invalidateDbCache(scenarioKey);
                    viewportCtxCache.remove(scenarioKey);
                }
            } catch (Exception e) {
                logger.error("[generateVehicleRoute] 더미 데이터 생성/업로드 실패", e);
            }
            if (vehicleEvents.isEmpty()) {
                throw new java.io.FileNotFoundException("시뮬레이션 결과 파일(vehicle_sim.db)이 없습니다: " + scenarioKey);
            }
        }

        stageMap.put(scenarioKey, "차량 이벤트 그룹화 중... (" + vehicleEvents.size() + "건)");
        Map<String, List<VehicleEvent>> grouped = vehicleEvents.stream()
                .collect(Collectors.groupingBy(VehicleEvent::getId));

        Map<String, VehicleInfo> vehicleInfoMap = vehicleDataReader.readVehicleInfoMap(scenarioKey);

        List<Map<String, Object>> czml = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, Object>> featureList = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, Object>> vehiclePathList = Collections.synchronizedList(new ArrayList<>());

        Instant startTime = Instant.now();

        long baseEpoch = startTime.getEpochSecond();

        // 시뮬레이션 실제 시간 범위 계산
        double simMinTime = grouped.values().stream()
                .flatMap(List::stream)
                .mapToDouble(v -> v.getTimestep())
                .min().orElse(0);
        double simMaxTime = grouped.values().stream()
                .flatMap(List::stream)
                .mapToDouble(v -> v.getTimestep())
                .max().orElse(600);
        // 신호 타임라인은 t=0 기준으로 생성 (offset은 시뮬레이션 t=0 기준 위상 오프셋)
        // 사이클 커버 범위: t=0 ~ simMaxTime
        int simulationDuration = (int) Math.ceil(simMaxTime) + 10; // 여유 10초

        stageMap.put(scenarioKey, "CZML 좌표 변환 중... (차량 " + grouped.size() + "대)");
        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(baseEpoch, "0", scenarioKey, simulationDuration);

        Instant[] range = buildVehiclePackets(grouped, roadMap, converterCache, scenario, baseEpoch,
                startTime, vehicleInfoMap, czml, featureList, vehiclePathList);
        Instant globalStart = range[0];
        Instant globalStop  = range[1];

        if (globalStart == null || globalStop == null) {
            throw new java.io.FileNotFoundException(
                "차량 경로 생성 실패: 유효한 좌표가 없습니다 (roadMap에 링크가 없거나 vehicle_sim.db가 비어있음) — scenarioKey=" + scenarioKey);
        }

        Map<String, Object> documentPacket = Map.of(
                "id", "document",
                "name", "Vehicle Movement",
                "version", "1.0",
                "clock", Map.of(
                        "interval", globalStart + "/" + globalStop,
                        "currentTime", globalStart.toString(),
                        "multiplier", 1,
                        "range", "CLAMPED",
                        "step", "SYSTEM_CLOCK_MULTIPLIER"
                )
        );
        czml.addFirst(documentPacket);

        stageMap.put(scenarioKey, "DB 저장 중...");
        vehicleRouteService.saveRoute(scenarioKey, czml, featureList, vehiclePathList, baseEpoch, scenarioKey);
        stageMap.remove(scenarioKey);

        Map<String, Object> response = new HashMap<>();
        response.put("czml", czml);
        response.put("features", featureList);
        response.put("positions", vehiclePathList);

        response.put("signalTimeline", signalTimeline);

        return ResponseEntity.ok(response);
    }

    /**
     * 차량 이벤트 그룹 → CZML 패킷/feature/positions 빌드 (generateVehicleRoute·viewport 공용).
     * @return [earliestStart, latestStop] — 유효 차량이 없으면 [null, null]
     */
    private Instant[] buildVehiclePackets(
            Map<String, List<VehicleEvent>> grouped,
            Map<String, RoadResponse.Road> roadMap,
            Map<String, CoordinateConverter> converterCache,
            Scenario scenario,
            long baseEpoch,
            Instant startTime,
            Map<String, VehicleInfo> vehicleInfoMap,
            List<Map<String, Object>> czml,
            List<Map<String, Object>> featureList,
            List<Map<String, Object>> vehiclePathList) {

        AtomicReference<Instant> earliestStartRef = new AtomicReference<>(null);
        AtomicReference<Instant> latestStopRef = new AtomicReference<>(null);

        grouped.entrySet().parallelStream().forEach(entry -> {
            String vehicleId = entry.getKey();
            List<VehicleEvent> vehicles = entry.getValue();
            if (vehicles.isEmpty()) return;

            double firstTimestep = vehicles.get(0).getTimestep();
            double lastTimestep = vehicles.get(vehicles.size() - 1).getTimestep();

            Instant vehicleStart = Instant.ofEpochSecond(baseEpoch + (long) firstTimestep);
            Instant vehicleStop = Instant.ofEpochSecond(baseEpoch + (long) lastTimestep);

            earliestStartRef.updateAndGet(current ->
                    (current == null || vehicleStart.isBefore(current)) ? vehicleStart : current);
            latestStopRef.updateAndGet(current ->
                    (current == null || vehicleStop.isAfter(current)) ? vehicleStop : current);

            List<Map.Entry<Double, Cartesian3>> path = new ArrayList<>();
            List<Cartesian3> path2d = new ArrayList<>();

            for (VehicleEvent vehicle : vehicles) {
                String key = vehicle.getLinkId();

                // 교차로 구간: DB link_id가 node_id인 경우 "nodeId_laneId" 키로 조회
                boolean isConnection = false;
                if (!roadMap.containsKey(key)) {
                    key = vehicle.getLinkId() + "_" + vehicle.getLaneId();
                    isConnection = true;
                }

                RoadResponse.Road baseRoad = roadMap.get(key);
                if (baseRoad == null) {
                    // 네트워크에 없는 링크: 스킵 (GAP_THRESHOLD 초과 시 차량이 사라졌다 나타남)
                    continue;
                }

                ProjCoordinate actualCoord;
                if (baseRoad.getLaneShape() != null) {
                    if (isConnection) {
                        // connection: bezier 곡선이 차선 중심선 → posY 오프셋 불필요
                        actualCoord = CoordinateConverter.interpolateAlongLane(
                                baseRoad.getLaneShape(), vehicle.getPosX(),
                                scenario.getLongitude(), scenario.getLatitude());
                    } else {
                        // regular link: shape 폴리라인을 따르되 posY 횡방향 오프셋 적용
                        actualCoord = CoordinateConverter.interpolateAlongShapeWithOffset(
                                baseRoad.getLaneShape(), vehicle.getPosX(), vehicle.getPosY(), baseRoad.getHalfWidth(),
                                scenario.getLongitude(), scenario.getLatitude());
                    }
                    if (actualCoord == null) actualCoord = converterCache.get(key).toAbsolute(vehicle.getPosX(), vehicle.getPosY());
                } else {
                    actualCoord = converterCache.get(key).toAbsolute(vehicle.getPosX(), vehicle.getPosY());
                }

                Cartesian3 pos = Cartesian3.fromDegrees(actualCoord.x, actualCoord.y, 0);

                path.add(Map.entry(vehicle.getTimestep(), pos));
                path2d.add(pos);  // 재사용

            }

            if (path2d.isEmpty()) return;

            // 7초 이상 gap이 있는 구간에서 availability 구간을 분리
            // → 차량이 날아가는 대신 사라졌다가 다시 나타남
            final double GAP_THRESHOLD = 7.0;
            List<String> availabilityIntervals = new ArrayList<>();
            double segStart = path.get(0).getKey();
            double prevTime = segStart;
            for (int i = 1; i < path.size(); i++) {
                double currTime = path.get(i).getKey();
                if (currTime - prevTime > GAP_THRESHOLD) {
                    availabilityIntervals.add(
                            Instant.ofEpochSecond(baseEpoch + (long) segStart) + "/" +
                                    Instant.ofEpochSecond(baseEpoch + (long) prevTime));
                    segStart = currTime;
                }
                prevTime = currTime;
            }
            availabilityIntervals.add(
                    Instant.ofEpochSecond(baseEpoch + (long) segStart) + "/" +
                            Instant.ofEpochSecond(baseEpoch + path.get(path.size() - 1).getKey().longValue()));

            Object availability = availabilityIntervals.size() == 1
                    ? availabilityIntervals.get(0)
                    : availabilityIntervals;

            List<Double> cartesianArray = new ArrayList<>(path.size() * 4);
            for (Map.Entry<Double, Cartesian3> p : path) {
                cartesianArray.add(p.getKey());
                cartesianArray.add(p.getValue().getX());
                cartesianArray.add(p.getValue().getY());
                cartesianArray.add(p.getValue().getZ());
            }

            List<List<Double>> lineCoordinates = path2d.stream()
                    .map(p -> List.of(p.getX(), p.getY(), p.getZ()))
                    .toList();

            List<List<Double>> positionsInterval = path.stream()
                    .map(p -> List.of(p.getKey()))
                    .toList();

            Map<String, Object> czmlPacket = Map.of(
                    "id", vehicleId,
                    "availability", availability,
                    "position", Map.of(
                            "epoch", startTime.toString(),
                            "interpolationAlgorithm", "LINEAR",
                            "interpolationDegree", 1,
                            "cartesian", cartesianArray
                    ),
                    "orientation", Map.of("velocityReference", "#position")
            );

            Map<String, Object> feature = Map.of(
                    "geometry", Map.of(
                            "type", "LineString",
                            "coordinates", lineCoordinates
                    ),
                    "properties", Map.of(
                            "id", vehicleId,
                            "availability", availability,
                            "positionsInterval", positionsInterval
                    )
            );

            czml.add(czmlPacket);
            featureList.add(feature);

            Map<String, Object> vehicleEntry = new HashMap<>();
            vehicleEntry.put("id", vehicleId);
            vehicleEntry.put("type", resolveVehicleType(vehicleId, vehicles.get(0).getType()));
            vehicleEntry.put("path", cartesianArray);
            VehicleInfo info = vehicleInfoMap.get(vehicleId);
            if (info != null) {
                vehicleEntry.put("length", info.getLength());
                vehicleEntry.put("width", info.getWidth());
            }
            vehiclePathList.add(vehicleEntry);
        });

        return new Instant[]{ earliestStartRef.get(), latestStopRef.get() };
    }

    // ─────────────── 차량 viewport+시간창 스트리밍 (개별 차량 near LOD) ───────────────

    /** scenarioKey → 스트리밍 컨텍스트 (roadMap/converter/기준시각 — network.xml 파싱 1회 캐시) */
    private final ConcurrentHashMap<String, ViewportCtx> viewportCtxCache = new ConcurrentHashMap<>();

    private record ViewportCtx(Map<String, RoadResponse.Road> roadMap,
                               Map<String, CoordinateConverter> converterCache,
                               Scenario scenario,
                               Map<String, VehicleInfo> vehicleInfoMap,
                               long baseEpoch, double simMin, double simMax) {}

    private ViewportCtx ensureViewportCtx(String scenarioKey) throws IOException {
        ViewportCtx c = viewportCtxCache.get(scenarioKey);
        if (c != null) return c;
        synchronized (viewportCtxCache) {
            c = viewportCtxCache.get(scenarioKey);
            if (c != null) return c;

            Scenario scenario = scenarioService.getScenarioByKey(scenarioKey);
            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                throw new IOException("시나리오 기준 좌표 없음: " + scenarioKey);
            }
            long t0 = System.currentTimeMillis();
            byte[] networkBytes;
            try (InputStream raw = new URL(remoteUrl + scenarioKey + "/network.xml").openStream()) {
                networkBytes = raw.readAllBytes();
            }
            List<RoadResponse.Road> roads = GeoJsonUtils.parseXmlToRoads(new ByteArrayInputStream(networkBytes));
            Map<String, RoadResponse.Road> roadMap = roads.stream().collect(Collectors.toMap(
                    RoadResponse.Road::getLinkId, Function.identity(), (r1, r2) -> r1));
            Map<String, CoordinateConverter> converters = new ConcurrentHashMap<>();
            roadMap.forEach((key, road) -> {
                CoordinateConverter converter = new CoordinateConverter();
                converter.setBasePoint(scenario.getLongitude(), scenario.getLatitude());
                converter.setRoadPoint(road.getBaseEasting(), road.getBaseNorthing(),
                        road.getTargetEasting(), road.getTargetNorthing(), road.getHalfWidth());
                converters.put(key, converter);
            });
            double[] simRange = vehicleDataReader.readSimTimeRange(scenarioKey);
            Map<String, VehicleInfo> infoMap = vehicleDataReader.readVehicleInfoMap(scenarioKey);
            // baseEpoch은 컨텍스트 수명 동안 고정 → viewport 요청 간 CZML epoch/clock 이 일치 (재생 연속성)
            long baseEpoch = Instant.now().getEpochSecond();
            c = new ViewportCtx(roadMap, converters, scenario, infoMap, baseEpoch, simRange[0], simRange[1]);
            viewportCtxCache.put(scenarioKey, c);
            logger.info("[viewport] {} 컨텍스트 빌드 완료 ({}ms, roads={}, simRange={}~{})",
                    scenarioKey, System.currentTimeMillis() - t0, roadMap.size(), simRange[0], simRange[1]);
            return c;
        }
    }

    /** viewport 요청당 선별 차량 기본 상한 (응답 폭주 방지). numVehicle 로 요청별 조정 가능 */
    private static final int VIEWPORT_DEFAULT_MAX_VEHICLES = 3000;
    /** 요청이 아무리 커도 넘지 못하는 하드캡 (~260MB 응답 방지) */
    private static final int VIEWPORT_HARD_CAP = 10_000;

    /**
     * viewport(bbox) + 재생 시간창의 차량 궤적만 반환 (대용량 시나리오 개별 차량 스트리밍).
     * 캐시/더미 생성 없음 — vehicle_sim.db 가 없으면 404.
     * body: { bbox: "w,s,e,n", fromTime?, toTime?, bufferSec? }
     */
    @PostMapping("/vehicle-route/{scenarioKey}/viewport")
    public ResponseEntity<Map<String, Object>> getVehicleRouteViewport(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) {
        try {
            if (request.getBbox() == null || request.getBbox().isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "bbox 파라미터가 필요합니다"));
            }
            String[] p = request.getBbox().split(",");
            if (p.length != 4) {
                return ResponseEntity.badRequest().body(Map.of("error", "bbox 형식: west,south,east,north"));
            }
            double west = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            if (!fileStorage.exists(scenarioKey + "/vehicle_sim.db")) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "vehicle_sim.db 없음: " + scenarioKey));
            }

            ViewportCtx ctx = ensureViewportCtx(scenarioKey);

            // 1) bbox 내 링크 (네트워크 SQLite RTree 재사용 — link-traffic 과 동일 협업)
            List<String> linkIds = new ArrayList<>();
            for (var link : networkTileService.queryByBbox(
                    scenarioKey, west, south, east, north, NetworkTileService.Lod.NEAR).getLinks()) {
                if (link.getId() != null) linkIds.add(String.valueOf(link.getId()));
            }

            // 2) 시간창 (버퍼 포함) — fromTime/toTime 없으면 전체
            int buffer = request.getBufferSec() != null ? request.getBufferSec() : 60;
            double from = 0, to = 0;
            if (request.getFromTime() != null && request.getToTime() != null) {
                from = Math.max(0, request.getFromTime() - buffer);
                to = request.getToTime() + (double) buffer;
            }

            // 3) 차량 선별 + 궤적 슬라이싱 → CZML 빌드 (캐시 저장 없음).
            //    상한: 요청 numVehicle(>0) 우선, 하드캡 이내로 제한
            int maxVehicles = request.getNumVehicle() > 0
                    ? Math.min(request.getNumVehicle(), VIEWPORT_HARD_CAP)
                    : VIEWPORT_DEFAULT_MAX_VEHICLES;
            long t0 = System.currentTimeMillis();
            VehicleDataReader.FilteredVehicleEvents filtered = vehicleDataReader.readVehicleEventsFiltered(
                    scenarioKey, linkIds, from, to, maxVehicles);
            List<VehicleEvent> events = filtered.events();
            Map<String, List<VehicleEvent>> grouped = events.stream()
                    .collect(Collectors.groupingBy(VehicleEvent::getId));

            List<Map<String, Object>> czml = Collections.synchronizedList(new ArrayList<>());
            List<Map<String, Object>> featureList = Collections.synchronizedList(new ArrayList<>());
            List<Map<String, Object>> vehiclePathList = Collections.synchronizedList(new ArrayList<>());
            buildVehiclePackets(grouped, ctx.roadMap(), ctx.converterCache(), ctx.scenario(),
                    ctx.baseEpoch(), Instant.ofEpochSecond(ctx.baseEpoch()), ctx.vehicleInfoMap(),
                    czml, featureList, vehiclePathList);

            // document clock 은 전체 시뮬 시간 범위 (viewport 마다 달라지지 않음 → 재생 clock 안정)
            Instant globalStart = Instant.ofEpochSecond(ctx.baseEpoch() + (long) ctx.simMin());
            Instant globalStop = Instant.ofEpochSecond(ctx.baseEpoch() + (long) Math.ceil(ctx.simMax()));
            Map<String, Object> documentPacket = Map.of(
                    "id", "document",
                    "name", "Vehicle Movement",
                    "version", "1.0",
                    "clock", Map.of(
                            "interval", globalStart + "/" + globalStop,
                            "currentTime", globalStart.toString(),
                            "multiplier", 1,
                            "range", "CLAMPED",
                            "step", "SYSTEM_CLOCK_MULTIPLIER"
                    )
            );
            czml.addFirst(documentPacket);

            boolean truncated = filtered.totalVehicles() > maxVehicles;
            logger.info("[viewport] {} bbox=({},{},{},{}) window={}~{} → 차량 {}/{}대{}, 이벤트 {}건 ({}ms)",
                    scenarioKey, west, south, east, north, from, to,
                    grouped.size(), filtered.totalVehicles(), truncated ? " (상한 초과)" : "",
                    events.size(), System.currentTimeMillis() - t0);

            Map<String, Object> response = new HashMap<>();
            response.put("czml", czml);
            response.put("features", featureList);
            response.put("positions", vehiclePathList);
            response.put("simRange", List.of(ctx.simMin(), ctx.simMax()));
            response.put("window", Map.of("fromTime", from, "toTime", to, "bufferSec", buffer));
            response.put("totalVehicles", filtered.totalVehicles());
            response.put("truncated", truncated);
            return ResponseEntity.ok(response);

        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "bbox 숫자 형식 오류"));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[viewport] {} 요청 실패", scenarioKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "알 수 없는 오류"));
        }
    }

    @GetMapping("/signal-timeline/{scenarioKey}")
    public ResponseEntity<List<SignalTimelineResponse>> getSignalTimelineByPlan(
            @PathVariable String scenarioKey,
            @RequestParam long baseEpoch,
            @RequestParam String planId,
            @RequestParam int duration) {
        logger.info("[getSignalTimelineByPlan] scenarioKey={}, planId={}, baseEpoch={}, duration={}", scenarioKey, planId, baseEpoch, duration);
        try {
            List<SignalTimelineResponse> result = signalTimelineService.generateSignalTimeline(baseEpoch, planId, scenarioKey, duration);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            logger.error("[getSignalTimelineByPlan] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** VehicleDataReader가 지원하는 테이블별 필수 컬럼 (하나라도 매칭되면 유효한 vehicle_sim.db) */
    private static final Map<String, List<String>> VEHICLE_DB_REQUIRED_COLUMNS = Map.of(
            "VehicleEvent", List.of("veh_id", "timestep", "link_id", "lane_id", "pos_x", "pos_y"),
            "VehicleEventDebugging", List.of("veh_id", "type", "timestep", "link_id", "lane_id", "pos_x", "pos_y", "spd", "acc", "spacing", "mode", "leader_id", "target_lane_id"),
            "vehicle_sim", List.of("id", "timestep", "pos_x", "pos_y", "link_id")
    );

    /** 시뮬레이션 결과 SQLite 파일(vehicle_sim.db) 업로드 — SFTP 저장 후 캐시된 경로 데이터 삭제 */
    @PostMapping("/upload-db/{versionId}")
    public ResponseEntity<Map<String, Object>> uploadVehicleSimDb(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) throws IOException {
        logger.info("[uploadVehicleSimDb] versionId={}, filename={}, size={}bytes", versionId, file.getOriginalFilename(), file.getSize());

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "파일이 비어 있습니다."));
        }

        byte[] header = new byte[16];
        try (InputStream is = file.getInputStream()) {
            int read = is.readNBytes(header, 0, 16);
            if (read < 15 || !"SQLite format 3".equals(new String(header, 0, 15, StandardCharsets.US_ASCII))) {
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(Map.of("error", "유효한 SQLite(.db) 파일이 아닙니다. (SQLite 헤더 불일치)"));
            }
        }

        File tempFile = File.createTempFile("vehicle_sim_upload_", ".db");
        try {
            file.transferTo(tempFile);

            String schemaError = validateVehicleSimDbSchema(tempFile);
            if (schemaError != null) {
                logger.warn("[uploadVehicleSimDb] 스키마 검증 실패 versionId={}: {}", versionId, schemaError);
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(Map.of("error", schemaError));
            }

            try (InputStream is = new FileInputStream(tempFile)) {
                fileStorage.uploadFile(is, versionId, "vehicle_sim.db");
            }
        } finally {
            tempFile.delete();
        }
        logger.info("[uploadVehicleSimDb] {} vehicle_sim.db SFTP 업로드 완료", versionId);

        // 캐시된 차량 경로 데이터 삭제 → 다음 재생 시 새 DB로 재생성
        vehicleRouteService.getByVersionId(versionId).ifPresent(vehicleRouteService::deleteRoute);
        // viewport 스트리밍 컨텍스트/DB 사본 캐시도 무효화 (새 DB 반영)
        viewportCtxCache.remove(versionId);
        vehicleDataReader.invalidateDbCache(versionId);

        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    /**
     * 업로드된 SQLite 파일이 VehicleDataReader가 읽을 수 있는 스키마인지 검사한다.
     * VehicleEvent / VehicleEventDebugging / vehicle_sim 테이블 중 하나가 필요한 컬럼을 모두 갖춰야 한다.
     * @return 문제 없으면 null, 문제가 있으면 사용자에게 보여줄 에러 메시지
     */
    private String validateVehicleSimDbSchema(File dbFile) {
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath())) {
            Set<String> tableNames = new HashSet<>();
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "%", new String[]{"TABLE"})) {
                while (rs.next()) tableNames.add(rs.getString("TABLE_NAME"));
            }

            String matchedKey = null;
            String matchedTable = null;
            for (String candidate : VEHICLE_DB_REQUIRED_COLUMNS.keySet()) {
                String found = tableNames.stream().filter(candidate::equalsIgnoreCase).findFirst().orElse(null);
                if (found != null) {
                    matchedKey = candidate;
                    matchedTable = found;
                    break;
                }
            }

            if (matchedTable == null) {
                return String.format(
                        "차량 시뮬레이션 데이터 테이블(VehicleEvent, VehicleEventDebugging, vehicle_sim)을 찾을 수 없습니다. "
                                + "이 DB에 있는 테이블: %s",
                        tableNames.isEmpty() ? "없음" : String.join(", ", tableNames));
            }

            Set<String> columns = new HashSet<>();
            try (ResultSet rs = conn.getMetaData().getColumns(null, null, matchedTable, "%")) {
                while (rs.next()) columns.add(rs.getString("COLUMN_NAME").toLowerCase());
            }

            List<String> missing = VEHICLE_DB_REQUIRED_COLUMNS.get(matchedKey).stream()
                    .filter(col -> !columns.contains(col.toLowerCase()))
                    .toList();

            if (!missing.isEmpty()) {
                return String.format(
                        "%s 테이블에 필요한 컬럼이 없습니다: %s (현재 컬럼: %s)",
                        matchedTable, String.join(", ", missing), String.join(", ", columns));
            }

            return null;
        } catch (SQLException e) {
            return "SQLite 파일을 읽을 수 없습니다: " + e.getMessage();
        }
    }

    @GetMapping("/vehicle-route/{scenarioKey}/exists")
    public ResponseEntity<Map<String, Object>> checkVehicleRouteExists(@PathVariable String scenarioKey) {
        boolean exists = vehicleRouteService.getByVersionId(scenarioKey).isPresent();
        boolean generating = generatingSet.containsKey(scenarioKey);
        // 시뮬 원본(vehicle_sim.db) 존재 여부 — CZML 캐시가 없어도 원본이 있으면 로드 가능
        // (프론트가 "데이터 있을 때만 POST" 판단에 사용 → 더미 자동 생성 방지)
        boolean simDbExists = exists || fileStorage.exists(scenarioKey + "/vehicle_sim.db");
        return ResponseEntity.ok(Map.of("exists", exists, "generating", generating, "simDbExists", simDbExists));
    }

    @DeleteMapping("/vehicle-route/{scenarioKey}")
    public ResponseEntity<Void> deleteVehicleRoute(@PathVariable String scenarioKey) {
        generatingSet.remove(scenarioKey);
        viewportCtxCache.remove(scenarioKey);
        vehicleDataReader.invalidateDbCache(scenarioKey);
        vehicleRouteService.getByVersionId(scenarioKey).ifPresent(vehicleRouteService::deleteRoute);
        try {
            fileStorage.deleteFile(scenarioKey + "/vehicle_sim.db");
        } catch (Exception e) {
            logger.warn("[vehicle-route] {} vehicle_sim.db 삭제 실패(무시): {}", scenarioKey, e.getMessage());
        }
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/vehicle-route/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) throws IOException {

        // regenerate=true이면 캐시 강제 삭제 후 처음부터 재생성
        if (request.isRegenerate()) {
            logger.info("[vehicle-route] {} 강제 재생성 요청 — CZML 캐시 및 vehicle_sim.db 삭제", scenarioKey);
            vehicleRouteService.getByVersionId(scenarioKey).ifPresent(vehicleRouteService::deleteRoute);
            failedSet.remove(scenarioKey);
            viewportCtxCache.remove(scenarioKey);
            vehicleDataReader.invalidateDbCache(scenarioKey);
            try {
                fileStorage.deleteFile(scenarioKey + "/vehicle_sim.db");
                logger.info("[vehicle-route] {} vehicle_sim.db 삭제 완료", scenarioKey);
            } catch (Exception e) {
                logger.warn("[vehicle-route] {} vehicle_sim.db 삭제 실패(무시): {}", scenarioKey, e.getMessage());
            }
        }

        Optional<VehicleRoute> optional = vehicleRouteService.getByVersionId(scenarioKey);

        if (optional.isEmpty()) {
            // 대용량 DB: 전체 CZML 캐시를 만들지 않는 정책 → 생성 재시작 없이 largeMode 즉시 반환.
            // (없으면 폴링이 매번 '캐시 없음 → 재생성'을 반복하는 무한 루프가 됨)
            if (!generatingSet.containsKey(scenarioKey)) {
                long evCount = vehicleDataReader.countEvents(scenarioKey);
                if (evCount > LARGE_EVENT_THRESHOLD) {
                    logger.info("[vehicle-route] {} 대용량 DB (이벤트 {}건) — largeMode 응답 (viewport 스트리밍 사용)", scenarioKey, evCount);
                    return ResponseEntity.ok(Map.of("status", "ok", "largeMode", true, "events", evCount));
                }
            }

            // 이전 생성 실패 에러가 있으면 반환
            String failMsg = failedSet.remove(scenarioKey);
            if (failMsg != null) {
                logger.warn("[vehicle-route] {} 이전 생성 실패 결과 반환: {}", scenarioKey, failMsg);
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(Map.of("status", "failed", "message", failMsg));
            }
            // 이미 생성 중이면 202 반환 (현재 단계 포함)
            if (generatingSet.containsKey(scenarioKey)) {
                String stage = stageMap.getOrDefault(scenarioKey, "처리 중...");
                long elapsedSec = startTimeMap.containsKey(scenarioKey)
                        ? (System.currentTimeMillis() - startTimeMap.get(scenarioKey)) / 1000
                        : 0;
                logger.info("[vehicle-route] {} 생성 중 [{}] {}초 경과", scenarioKey, stage, elapsedSec);
                return ResponseEntity.status(HttpStatus.ACCEPTED)
                        .body(Map.of("status", "generating",
                                "stage", stage,
                                "elapsed", elapsedSec,
                                "message", stage));
            }
            // 명시적 생성 요청이 아니고 시뮬 원본(vehicle_sim.db)도 없으면 생성 스레드를 띄우지 않는다
            // (로드 경로 POST가 더미 생성을 유발하지 않도록 — 생성은 프론트 생성 버튼 전용)
            if (!request.isGenerateDummy() && !fileStorage.exists(scenarioKey + "/vehicle_sim.db")) {
                logger.info("[vehicle-route] {} 시뮬 원본 없음 + 비명시 요청 — 404 반환 (더미 생성 안 함)", scenarioKey);
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("status", "no-data",
                                "message", "시뮬레이션 데이터가 없습니다. 시뮬레이션 생성 버튼으로 생성하세요."));
            }
            // 비동기 생성 시작 후 202 반환
            generatingSet.put(scenarioKey, true);
            startTimeMap.put(scenarioKey, System.currentTimeMillis());
            stageMap.put(scenarioKey, "초기화 중...");
            logger.info("[vehicle-route] {} 비동기 생성 시작", scenarioKey);
            final VehicleRequest req = request;
            new Thread(() -> {
                try {
                    ResponseEntity<Map<String, Object>> result = generateVehicleRoute(req, scenarioKey);
                    if (!result.getStatusCode().is2xxSuccessful()) {
                        // 반환된 에러 ResponseEntity → 예외로 변환하여 failedSet에 등록
                        Object body = result.getBody();
                        String errMsg = "알 수 없는 오류";
                        if (body instanceof Map<?, ?> m) {
                            Object e = m.get("error");
                            if (e != null) errMsg = e.toString();
                        }
                        throw new RuntimeException(errMsg);
                    }
                    logger.info("[vehicle-route] {} 생성 완료", scenarioKey);
                } catch (Throwable e) {
                    // Exception 만 잡으면 OutOfMemoryError 가 failedSet 에 등록되지 않아
                    // 프론트 폴링이 생성을 무한 재시작 → OOM 반복. Throwable 로 잡아 실패 확정.
                    logger.error("[vehicle-route] {} 생성 실패: {}", scenarioKey, e.getMessage());
                    failedSet.put(scenarioKey, e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                } finally {
                    generatingSet.remove(scenarioKey);
                    startTimeMap.remove(scenarioKey);
                    stageMap.remove(scenarioKey);
                }
            }, "vehicle-gen-" + scenarioKey).start();

            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating",
                            "stage", "초기화 중...",
                            "elapsed", 0,
                            "message", "차량 경로 데이터 생성을 시작했습니다."));
        }

        VehicleRoute route = optional.get();

        // czml이 null이면 스테일 레코드 — 삭제 후 재생성
        if (route.getCzml() == null) {
            logger.warn("[vehicle-route] {} DB 레코드는 있으나 czml null — 삭제 후 재생성", scenarioKey);
            vehicleRouteService.deleteRoute(route);
            // 재귀 호출 없이 즉시 비동기 생성 시작
            if (!generatingSet.containsKey(scenarioKey)) {
                generatingSet.put(scenarioKey, true);
                startTimeMap.put(scenarioKey, System.currentTimeMillis());
                stageMap.put(scenarioKey, "초기화 중...");
                final VehicleRequest req = request;
                new Thread(() -> {
                    try {
                        ResponseEntity<Map<String, Object>> result = generateVehicleRoute(req, scenarioKey);
                        if (!result.getStatusCode().is2xxSuccessful()) {
                            Object body = result.getBody();
                            String errMsg = "알 수 없는 오류";
                            if (body instanceof Map<?, ?> m) {
                                Object e = m.get("error");
                                if (e != null) errMsg = e.toString();
                            }
                            throw new RuntimeException(errMsg);
                        }
                        logger.info("[vehicle-route] {} 재생성 완료", scenarioKey);
                    } catch (Exception e) {
                        logger.error("[vehicle-route] {} 재생성 실패: {}", scenarioKey, e.getMessage());
                        failedSet.put(scenarioKey, e.getMessage() != null ? e.getMessage() : "알 수 없는 오류");
                    } finally {
                        generatingSet.remove(scenarioKey);
                        startTimeMap.remove(scenarioKey);
                        stageMap.remove(scenarioKey);
                    }
                }, "vehicle-gen-" + scenarioKey).start();
            }
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating",
                            "stage", "초기화 중...",
                            "elapsed", 0,
                            "message", "경로 데이터 재생성 중입니다."));
        }

        ObjectMapper mapper = new ObjectMapper();

        String dataPath = route.getDataPath() != null ? route.getDataPath() : scenarioKey;
        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(route.getStartTime(), "0", dataPath, 7200);

        try {
            Map<String, Object> response = new HashMap<>();
            response.put("czml", mapper.readValue(route.getCzml(), Object.class));
            response.put("features", route.getFeatures() != null ? mapper.readValue(route.getFeatures(), Object.class) : List.of());
            response.put("positions", route.getPositions() != null ? mapper.readValue(route.getPositions(), Object.class) : List.of());
            response.put("signalTimeline", signalTimeline);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.warn("[vehicle-route] {} JSON 파싱 실패 — 삭제 후 재생성: {}", scenarioKey, e.getMessage());
            vehicleRouteService.deleteRoute(route);
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating", "message", "경로 데이터가 손상되어 재생성합니다."));
        }
    }

    /**
     * vehicle ID 또는 DB의 type 값을 기반으로 차량 유형을 결정합니다.
     * DB에 type 컬럼이 없거나 null인 경우 vehicle ID 숫자로 분포 배정합니다.
     * 배정 비율: CAR 70%, TAXI 15%, BUS 10%, TRUCK 4%, MOTO 1%
     */
    private String resolveVehicleType(String vehicleId, String dbType) {
        if (dbType != null && !dbType.isBlank()) {
            return dbType.toUpperCase();
        }
        // DB에 type 없을 때 vehicle ID 기반으로 배정
        try {
            int id = Integer.parseInt(vehicleId.replaceAll("[^0-9]", ""));
            int mod = id % 100;
            if (mod < 70)  return "CAR";
            if (mod < 85)  return "TAXI";
            if (mod < 95)  return "BUS";
            if (mod < 99)  return "TRUCK";
            return "MOTO";
        } catch (NumberFormatException e) {
            return "CAR";
        }
    }

    /**
     * signal.xml + NetworkXml을 파싱해 DummyVehicleGenerator.SignalContext를 생성한다.
     * signal.xml이 없거나 파싱 실패 시 빈 컨텍스트를 반환 (신호 무시).
     */
    private DummyVehicleGenerator.SignalContext buildSignalContext(NetworkXml networkXml, String signalXmlUrl) {
        // ── linkId → toNodeId ──────────────────────────────────────────
        Map<String, String> linkToNode = new HashMap<>();
        if (networkXml.getLinks() != null) {
            for (LinkXml link : networkXml.getLinks()) {
                if (link.getId() != null && link.getToNode() != null) {
                    linkToNode.put(String.valueOf(link.getId()), String.valueOf(link.getToNode()));
                }
            }
        }

        // ── "nodeId_connId" → {fromLinkId, toLinkId} ───────────────────
        // network.xml의 connection id는 노드별 로컬 ID(0,1,2,...)이므로
        // connId 단독을 전역 키로 쓰면 서로 다른 노드의 connection이 충돌한다.
        Map<String, String[]> connIdToMeta = new HashMap<>();
        if (networkXml.getNodes() != null) {
            for (NodeXml node : networkXml.getNodes()) {
                if (node.getConnections() == null) continue;
                String nodeId = String.valueOf(node.getId());
                for (ConnectionXml conn : node.getConnections()) {
                    if (conn.getId() == null || conn.getFromLink() == null || conn.getToLink() == null) continue;
                    connIdToMeta.put(nodeId + "_" + conn.getId(), new String[]{
                        String.valueOf(conn.getFromLink()),
                        String.valueOf(conn.getToLink())
                    });
                }
            }
        }

        // ── signal.xml 파싱 ───────────────────────────────────────────
        Map<String, DummyVehicleGenerator.NodeSignalInfo> nodeSignals = new HashMap<>();
        Map<String, String> connKeyToTurn = new HashMap<>();

        try (InputStream signalIs = new URL(signalXmlUrl).openStream()) {
            Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(signalIs);
            NodeList signalNodes = doc.getElementsByTagName("node");

            for (int i = 0; i < signalNodes.getLength(); i++) {
                Element nodeEl = (Element) signalNodes.item(i);
                String nodeId = nodeEl.getAttribute("id");

                // turn 파싱: connId → turnId, RTOR 여부
                Map<String, String> connIdStrToTurnId = new HashMap<>();
                Set<String> rtorTurns = new HashSet<>();

                NodeList turns = nodeEl.getElementsByTagName("turn");
                for (int t = 0; t < turns.getLength(); t++) {
                    Element turnEl = (Element) turns.item(t);
                    String turnId = turnEl.getAttribute("id");
                    String type   = turnEl.getAttribute("type");

                    if ("RTOR".equalsIgnoreCase(type)) rtorTurns.add(turnId);

                    // connList 또는 conn_list 속성
                    String connListStr = turnEl.getAttribute("connList");
                    if (connListStr.isEmpty()) connListStr = turnEl.getAttribute("conn_list");

                    for (String cid : connListStr.trim().split("\\s+")) {
                        if (!cid.isEmpty()) connIdStrToTurnId.put(cid, turnId);
                    }
                }

                // connKey 매핑 구성
                for (Map.Entry<String, String> entry : connIdStrToTurnId.entrySet()) {
                    String[] meta = connIdToMeta.get(nodeId + "_" + entry.getKey());
                    if (meta == null) continue;
                    String key    = nodeId + "_" + meta[0] + "_" + meta[1];
                    String turnId = entry.getValue();
                    // RTOR → 빈 문자열(항상 통과)
                    connKeyToTurn.put(key, rtorTurns.contains(turnId) ? "" : turnId);
                }

                // plan 파싱 (plan id="0" 우선, 없으면 첫 번째)
                Element planListEl = firstElement(nodeEl, "planList", "plan_list");
                if (planListEl == null) continue;

                NodeList plans = planListEl.getElementsByTagName("plan");
                Element selectedPlan = null;
                for (int p = 0; p < plans.getLength(); p++) {
                    Element plan = (Element) plans.item(p);
                    if ("0".equals(plan.getAttribute("id"))) { selectedPlan = plan; break; }
                }
                if (selectedPlan == null && plans.getLength() > 0) selectedPlan = (Element) plans.item(0);
                if (selectedPlan == null) continue;

                int cycle  = Integer.parseInt(selectedPlan.getAttribute("cycle"));
                int offset = Integer.parseInt(selectedPlan.getAttribute("offset"));

                NodeList phases = selectedPlan.getElementsByTagName("phase");
                List<DummyVehicleGenerator.PhaseInfo> phaseList = new ArrayList<>();
                for (int ph = 0; ph < phases.getLength(); ph++) {
                    Element phaseEl  = (Element) phases.item(ph);
                    int duration = Integer.parseInt(phaseEl.getAttribute("duration"));
                    String tList = phaseEl.getAttribute("turnList");
                    if (tList.isEmpty()) tList = phaseEl.getAttribute("turn_list");

                    Set<String> activeTurns = new HashSet<>(Arrays.asList(tList.trim().split("\\s+")));
                    activeTurns.remove("");
                    phaseList.add(new DummyVehicleGenerator.PhaseInfo(duration, activeTurns));
                }

                nodeSignals.put(nodeId, new DummyVehicleGenerator.NodeSignalInfo(cycle, offset, phaseList));
            }

            logger.info("[buildSignalContext] signal.xml 파싱 완료: 신호 노드 {}개, connKey 매핑 {}개",
                    nodeSignals.size(), connKeyToTurn.size());

        } catch (java.io.FileNotFoundException e) {
            logger.warn("[buildSignalContext] signal.xml 없음 — 네트워크 구조 기반 더미 신호 생성: {}", signalXmlUrl);
            return dummySignalGenerator.generate(networkXml, linkToNode);
        } catch (Exception e) {
            logger.warn("[buildSignalContext] signal.xml 파싱 실패 — 더미 신호로 대체: {}", e.getMessage());
            return dummySignalGenerator.generate(networkXml, linkToNode);
        }

        return new DummyVehicleGenerator.SignalContext(nodeSignals, linkToNode, connKeyToTurn);
    }

    /** tagNames 중 첫 번째로 존재하는 Element를 반환한다 (대소문자/언더스코어 변형 처리). */
    private Element firstElement(Element parent, String... tagNames) {
        for (String tag : tagNames) {
            NodeList nl = parent.getElementsByTagName(tag);
            if (nl.getLength() > 0) return (Element) nl.item(0);
        }
        return null;
    }
}