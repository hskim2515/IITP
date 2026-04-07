package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.*;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.network.road.RoadResponse;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.vehicle.route.VehicleRequest;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.signal.SignalTimelineResponse;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.signal.SignalTimelineService;
import com.iitp.iitp_rest.service.vehicle.VehicleRouteService;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.GeoJsonUtils;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.RequiredArgsConstructor;
import org.apache.commons.math3.complex.Quaternion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.apache.commons.math3.geometry.euclidean.threed.Vector3D;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.time.Duration;
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

    /** 현재 비동기 생성 중인 scenarioKey 집합 */
    private final java.util.concurrent.ConcurrentHashMap<String, Boolean> generatingSet = new java.util.concurrent.ConcurrentHashMap<>();

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    @PostMapping("/generate-vehicle-route/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> generateVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) throws IOException {

        Scenario scenario = scenarioService.getScenarioByKey(scenarioKey);

        String networkXmlUrl = remoteUrl + scenarioKey + "/network.xml";
        logger.info("[generateVehicleRoute] scenarioKey={}, networkXmlUrl={}", scenarioKey, networkXmlUrl);

        InputStream is;
        try {
            is = new URL(networkXmlUrl).openStream();
        } catch (java.io.FileNotFoundException e) {
            logger.warn("[generateVehicleRoute] 원격 데이터 없음: {}", networkXmlUrl);
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "데이터가 없습니다: " + scenarioKey));
        }

        List<RoadResponse.Road> roadEntities = GeoJsonUtils.parseXmlToRoads(is);

        // pos_x/pos_y가 링크 기준 좌표계이므로 linkId로만 키잉
        Map<String, RoadResponse.Road> roadMap = roadEntities.stream().collect(Collectors.toMap(
                RoadResponse.Road::getLinkId,
                Function.identity(),
                (r1, r2) -> r1
        ));

        // CoordinateConverter 사전 생성
        Map<String, CoordinateConverter> converterCache = new ConcurrentHashMap<>();
        roadMap.forEach((key, road) -> {
            CoordinateConverter converter = new CoordinateConverter();
            converter.setBasePoint(scenario.getLongitude(), scenario.getLatitude());
            converter.setRoadPoint(road.getBaseEasting(), road.getBaseNorthing(), road.getTargetEasting(), road.getTargetNorthing(), road.getHalfWidth());
            converterCache.put(key, converter);
        });

        Map<String, List<VehicleEvent>> grouped = vehicleDataReader.readVehicleEvent(scenarioKey).stream()
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

        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(baseEpoch, "0", scenarioKey, simulationDuration);

        AtomicReference<Instant> earliestStartRef = new AtomicReference<>(null);
        AtomicReference<Instant> latestStopRef = new AtomicReference<>(null);

        grouped.entrySet().parallelStream().forEach(entry -> {
            String vehicleId = entry.getKey();
            List<VehicleEvent> vehicles = entry.getValue();
            if (vehicles.isEmpty()) return;

            double firstTimestep = vehicles.get(0).getTimestep();
            double lastTimestep = vehicles.get(vehicles.size() - 1).getTimestep();

            long startEpoch = baseEpoch + (long) firstTimestep;
            long stopEpoch = baseEpoch + (long) lastTimestep;

            Instant vehicleStart = Instant.ofEpochSecond(startEpoch);
            Instant vehicleStop = Instant.ofEpochSecond(stopEpoch);

            earliestStartRef.updateAndGet(current ->
                    (current == null || vehicleStart.isBefore(current)) ? vehicleStart : current);
            latestStopRef.updateAndGet(current ->
                    (current == null || vehicleStop.isAfter(current)) ? vehicleStop : current);

            List<Map.Entry<Double, Cartesian3>> path = new ArrayList<>();
            List<Cartesian3> path2d = new ArrayList<>();
            Cartesian3 lastValidPos = null;

            for (VehicleEvent vehicle : vehicles) {
                String key = vehicle.getLinkId();

                // 교차로 구간: DB link_id가 node_id인 경우 "nodeId_laneId" 키로 조회
                if (!roadMap.containsKey(key)) {
                    key = vehicle.getLinkId() + "_" + vehicle.getLaneId();
                }

                RoadResponse.Road baseRoad = roadMap.get(key);
                if (baseRoad == null) {
                    // 네트워크에 없는 링크(교차로 내부 등): 마지막 유효 위치를 유지하여
                    // 보간 시 차량이 멈춰 있도록 처리
                    if (lastValidPos != null) {
                        path.add(Map.entry(vehicle.getTimestep(), lastValidPos));
                        path2d.add(lastValidPos);
                    }
                    continue;
                }

                ProjCoordinate actualCoord;
                if (baseRoad.getLaneShape() != null) {
                    // non-straight connection: bezier 곡선 위에서 posX 거리만큼 보간
                    actualCoord = CoordinateConverter.interpolateAlongLane(
                            baseRoad.getLaneShape(), vehicle.getPosX(),
                            scenario.getLongitude(), scenario.getLatitude());
                    if (actualCoord == null) actualCoord = converterCache.get(key).toAbsolute(vehicle.getPosX(), vehicle.getPosY());
                } else {
                    CoordinateConverter converter = converterCache.get(key);
                    actualCoord = converter.toAbsolute(vehicle.getPosX(), vehicle.getPosY());
                }

                Cartesian3 pos = Cartesian3.fromDegrees(actualCoord.x, actualCoord.y, 0);
                lastValidPos = pos;

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

            List<Object> unitQuaternionArray = new ArrayList<>();

            Quaternion prevQuaternion = null;


            Cartesian3 first = path2d.getFirst();
            Cartesian3 last = path2d.get(path.size()-1);

            Vector3D initDirection = new Vector3D(
                    last.getX() - first.getX(),
                    last.getY() - first.getY(),
                    last.getZ() - first.getZ()
            );

            for (int i = 1; i < path.size(); i++) {
                double timeOffsetSeconds = path.get(i).getKey(); // Double형 초

                // 기준 시간에 timeOffsetSeconds 만큼 더한 Instant 계산
                Instant time = startTime.plus(Duration.ofNanos((long)(timeOffsetSeconds * 1_000_000_000L)));

                Cartesian3 prev = path2d.get(i - 1);
                Cartesian3 curr = path2d.get(i);

                // 방향 벡터 계산
                Vector3D direction = new Vector3D(
                        curr.getX() - prev.getX(),
                        curr.getY() - prev.getY(),
                        curr.getZ() - prev.getZ()
                );

                Quaternion q;
                if (direction.getNorm() < 1e-2) {  // 방향 없음 또는 매우 작을 때
                    q = prevQuaternion != null ? prevQuaternion : getQuaternionFromDirection(initDirection);
                } else {
                    q = getQuaternionFromDirection(direction);
                }

                prevQuaternion = q;

                // 단위 quaternion = [time, x, y, z, w]
                unitQuaternionArray.add(Duration.between(startTime, time).getSeconds());  // czml용 offset 시간 값
                unitQuaternionArray.add(q.getQ1()); // x
                unitQuaternionArray.add(q.getQ2()); // y
                unitQuaternionArray.add(q.getQ3()); // z
                unitQuaternionArray.add(q.getQ0()); // w
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
//                    "orientation", Map.of(
//                        "interpolationAlgorithm", "LINEAR",
//                        "interpolationDegree", 1,
//                        "epoch", startTime.toString(),
//                        "unitQuaternion", unitQuaternionArray
//                    )
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

        Instant globalStart = earliestStartRef.get();
        Instant globalStop = latestStopRef.get();

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

        vehicleRouteService.saveRoute(scenarioKey, czml, featureList, vehiclePathList, baseEpoch, scenarioKey);

        Map<String, Object> response = new HashMap<>();
        response.put("czml", czml);
        response.put("features", featureList);
        response.put("positions", vehiclePathList);

        response.put("signalTimeline", signalTimeline);

        return ResponseEntity.ok(response);
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

    @PostMapping("/vehicle-route/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) throws IOException {

        Optional<VehicleRoute> optional = vehicleRouteService.getByVersionId(scenarioKey);

        if (optional.isEmpty()) {
            // 이미 생성 중이면 202 반환
            if (generatingSet.containsKey(scenarioKey)) {
                logger.info("[vehicle-route] {} 생성 중, 202 반환", scenarioKey);
                return ResponseEntity.status(HttpStatus.ACCEPTED)
                        .body(Map.of("status", "generating", "message", "경로 데이터 생성 중입니다. 잠시 후 다시 시도하세요."));
            }
            // 비동기 생성 시작 후 202 반환
            generatingSet.put(scenarioKey, true);
            logger.info("[vehicle-route] {} 비동기 생성 시작", scenarioKey);
            final VehicleRequest req = request;
            new Thread(() -> {
                try {
                    generateVehicleRoute(req, scenarioKey);
                    logger.info("[vehicle-route] {} 생성 완료", scenarioKey);
                } catch (Exception e) {
                    logger.error("[vehicle-route] {} 생성 실패: {}", scenarioKey, e.getMessage());
                } finally {
                    generatingSet.remove(scenarioKey);
                }
            }, "vehicle-gen-" + scenarioKey).start();

            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating", "message", "경로 데이터 생성을 시작했습니다. 잠시 후 다시 시도하세요."));
        }

        VehicleRoute route = optional.get();
        ObjectMapper mapper = new ObjectMapper();

        String dataPath = route.getDataPath() != null ? route.getDataPath() : scenarioKey;
        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(route.getStartTime(), "0", dataPath, 7200);

        try {
            Map<String, Object> response = new HashMap<>();
            response.put("czml", mapper.readValue(route.getCzml(), Object.class));
            response.put("features", mapper.readValue(route.getFeatures(), Object.class));
            response.put("positions", mapper.readValue(route.getPositions(), Object.class));
            response.put("signalTimeline", signalTimeline);
            return ResponseEntity.ok(response);
        } catch (JsonProcessingException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to parse JSON"));
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

    // 단위 벡터 a를 기준으로 z축을 회전시켜 맞추는 쿼터니언 반환
    public Quaternion getQuaternionFromDirection(Vector3D direction) {
        Vector3D forward = direction.normalize(); // Z축 대체
        Vector3D up = new Vector3D(0, 0, 1); // 기본 Y축
        Vector3D right = Vector3D.crossProduct(up, forward).normalize(); // X축 방향
        up = Vector3D.crossProduct(forward, right); // 새로운 up 벡터

        // 회전 행렬 생성
        double[][] rot = new double[][]{
                {right.getX(), up.getX(), forward.getX()},
                {right.getY(), up.getY(), forward.getY()},
                {right.getZ(), up.getZ(), forward.getZ()}
        };

        // 회전 행렬을 쿼터니언으로 변환
        return rotationMatrixToQuaternion(rot);
    }

    // 3x3 회전 행렬을 쿼터니언으로 변환
    private Quaternion rotationMatrixToQuaternion(double[][] m) {
        double t = m[0][0] + m[1][1] + m[2][2];
        double x, y, z, w;
        if (t > 0) {
            double s = Math.sqrt(t + 1.0) * 2;
            w = 0.25 * s;
            x = (m[2][1] - m[1][2]) / s;
            y = (m[0][2] - m[2][0]) / s;
            z = (m[1][0] - m[0][1]) / s;
        } else if ((m[0][0] > m[1][1]) & (m[0][0] > m[2][2])) {
            double s = Math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2;
            w = (m[2][1] - m[1][2]) / s;
            x = 0.25 * s;
            y = (m[0][1] + m[1][0]) / s;
            z = (m[0][2] + m[2][0]) / s;
        } else if (m[1][1] > m[2][2]) {
            double s = Math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2;
            w = (m[0][2] - m[2][0]) / s;
            x = (m[0][1] + m[1][0]) / s;
            y = 0.25 * s;
            z = (m[1][2] + m[2][1]) / s;
        } else {
            double s = Math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2;
            w = (m[1][0] - m[0][1]) / s;
            x = (m[0][2] + m[2][0]) / s;
            y = (m[1][2] + m[2][1]) / s;
            z = 0.25 * s;
        }
        return new Quaternion(w, x, y, z); // Cesium은 w,x,y,z 순서
    }
}