package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.*;
import com.iitp.iitp_rest.model.network.RoadResponse;
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
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.AllArgsConstructor;
import org.apache.commons.math3.complex.Quaternion;
import org.apache.commons.math3.geometry.euclidean.threed.Vector3D;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/vehicle")
@AllArgsConstructor
public class VehicleController {

    private final VehicleDataReader vehicleDataReader;
    private final ScenarioService scenarioService;
    private final VehicleRouteService vehicleRouteService;
    private final SignalTimelineService signalTimelineService;

    @PostMapping("/generate-vehicle-route/{versionId}")
    public ResponseEntity<Map<String, Object>> generateVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String versionId) throws IOException {

        Scenario scenario = scenarioService.getScenarioByKey(versionId);

        if (scenario == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Scenario not found"));
        }

        String classpathLocation = versionId + "/network.xml";
        InputStream is = XmlUtils.loadXmlAsStream(classpathLocation);

        List<RoadResponse.Road> roadEntities = GeoJsonUtils.parseXmlToRoads(is);

        Map<String, RoadResponse.Road> roadMap = roadEntities.stream().collect(Collectors.toMap(
                road -> road.getLinkId() + "|" + road.getLaneId(),
                Function.identity(),
                (r1, r2) -> r1
        ));

        // CoordinateConverter 사전 생성
        Map<String, CoordinateConverter> converterCache = new ConcurrentHashMap<>();
        roadMap.forEach((key, road) -> {
            CoordinateConverter converter = new CoordinateConverter();
            converter.setBasePoint(scenario.getLongitude(), scenario.getLatitude());
            converter.setRoadPoint(road.getBaseEasting(), road.getBaseNorthing(), road.getTargetEasting(), road.getTargetNorthing());
            converterCache.put(key, converter);
        });

        Map<String, List<VehicleEvent>> grouped = vehicleDataReader.readVehicleEvent(versionId).stream()
                .collect(Collectors.groupingBy(VehicleEvent::getId));

        List<Map<String, Object>> czml = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, Object>> featureList = Collections.synchronizedList(new ArrayList<>());
        List<List<Double>> vehiclePathList = Collections.synchronizedList(new ArrayList<>());

        Instant startTime = Instant.now();

        long baseEpoch = startTime.getEpochSecond();

        // 타임라인 생성
        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(baseEpoch,"0");

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

            for (VehicleEvent vehicle : vehicles) {
                String key = vehicle.getLinkId() + "|" + vehicle.getLaneId();
                RoadResponse.Road baseRoad = roadMap.get(key);
                if (baseRoad == null) continue;

                CoordinateConverter converter = converterCache.get(key);
                ProjCoordinate actualCoord = converter.toAbsolute(vehicle.getPosX(), vehicle.getPosY());
                //System.out.println(actualCoord);
                Cartesian3 pos = Cartesian3.fromDegrees(actualCoord.x, actualCoord.y, 0);

                path.add(Map.entry(vehicle.getTimestep(), pos));
                path2d.add(pos);  // 재사용

            }

            if (path2d.isEmpty()) return;

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
                    "availability", vehicleStart + "/" + vehicleStop,
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
                            "availability", vehicleStart + "/" + vehicleStop,
                            "positionsInterval", positionsInterval
                    )
            );

            czml.add(czmlPacket);
            featureList.add(feature);
            vehiclePathList.add(cartesianArray);
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

        vehicleRouteService.saveRoute(versionId, czml, featureList, vehiclePathList, baseEpoch);

        Map<String, Object> response = new HashMap<>();
        response.put("czml", czml);
        response.put("features", featureList);
        response.put("positions", vehiclePathList);

        response.put("signalTimeline", signalTimeline);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/vehicle-route/{versionId}")
    public ResponseEntity<Map<String, Object>> getVehicleRoute(@PathVariable String versionId) {
        Optional<VehicleRoute> optional = vehicleRouteService.getByVersionId(versionId);

        if (optional.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Vehicle route not found"));
        }

        VehicleRoute route = optional.get();
        ObjectMapper mapper = new ObjectMapper();

        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(route.getStartTime(),"0");

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