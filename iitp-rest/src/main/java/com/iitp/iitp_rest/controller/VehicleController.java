package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.Network;
import com.iitp.iitp_rest.model.Road;
import com.iitp.iitp_rest.model.Vehicle;
import com.iitp.iitp_rest.model.VehicleState;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.request.VehicleRequest;
import com.iitp.iitp_rest.repository.NetworkRepository;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.GeoJsonUtils;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.AllArgsConstructor;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.cors.CorsConfigurationSource;

import java.io.IOException;
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

    private final NetworkRepository networkRepository;
    private final VehicleDataReader vehicleDataReader;
    private final CorsConfigurationSource corsConfigurationSource;

    @PostMapping("/generate-czml")
    public ResponseEntity<Map<String, Object>> generateCzml(@RequestBody VehicleRequest request) {
        List<Map<String, Object>> czml = new ArrayList<>();
        List<Vehicle> vehicleDataList = new ArrayList<>();
        List<List<Cartesian3>> vehiclePath = new ArrayList<>();


//         CZML 문서 정의
        czml.add(Map.of(
                "id", "document",
                "name", "Vehicle Movement",
                "version", "1.0"
        ));
        Network network = networkRepository.findById(1L).orElse(null);

        if (network == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Network data not found"));
        }

        // GeoJSON을 Road 리스트로 변환
        List<Road> roadEntities = GeoJsonUtils.parseGeoJsonToRoads(network.getGeojson());

        Map<Cartesian3, List<Road>> roadConnections = buildRoadConnections(roadEntities);


        Random random = new Random();
        for (int i = 0; i < request.getNumVehicle(); i++) {
            Road startRoad = roadEntities.get(random.nextInt(roadEntities.size())); // 랜덤 도로 선택
            List<Cartesian3> path = buildConnectedPath(startRoad, roadConnections, 2);

            if (path != null && !path.isEmpty()) {
                List<Double> positions = new ArrayList<>();
                double speedKmh = request.getSpeedFactor(); // 속도 (km/h)로 입력됨
                double speedMs = speedKmh * 1000 / 3600; // m/s 변환

                Instant startTime = Instant.now();
                Instant stopTime = startTime.plusSeconds(3600);

                double elapsedTime = 0.0; // 초기 시간 (초)
                Cartesian3 prevPosition = null; // 이전 좌표 저장

                for (int j = 0; j < path.size(); j++) {
                    Cartesian3 currentPosition = Cartesian3.fromDegrees(
                            path.get(j).getX(), path.get(j).getY(), path.get(j).getZ()
                    );

                    if (prevPosition != null) {
                        // 이전 지점과 현재 지점 간 거리 계산 (m)
                        double distance = Cartesian3.distance(prevPosition, currentPosition);

                        // 속도에 따른 경과 시간 (초) 추가
                        elapsedTime += distance / speedMs;
                    }

                    // CZML의 cartesian 시간-좌표 배열 구성
                    positions.add(elapsedTime); // 경과 시간 추가
                    positions.add(currentPosition.getX());
                    positions.add(currentPosition.getY());
                    positions.add(currentPosition.getZ());

                    prevPosition = currentPosition; // 이전 좌표 업데이트
                }


                String vehicleId = "vehicle" + i;
                czml.add(Map.of(
                        "id", vehicleId,
                        "availability", startTime.toString() + "/" + stopTime.toString(),
                        "position", Map.of(
                                "epoch", startTime.toString(),
                                "interpolationAlgorithm", "LINEAR",
                                "interpolationDegree", 2,
                                "cartesian", positions
                        ),
                        "orientation", Map.of("velocityReference", "#position"),
                        "point", Map.of(
                                "outlineWidth", 1,
                                "pixelSize", 10
                        )
                ));
                List<Integer> pathColor = new ArrayList<>();
                pathColor.add(255);
                pathColor.add(0);
                pathColor.add(0);
                pathColor.add(100);
//                czml.add(Map.of(
//                        "id", "path" + i,
//                        "availability", startTime.toString() + "/" + stopTime.toString(),
//                        "path", Map.of(
//                                "material", Map.of(
//                                        "polylineOutline", Map.of(
//                                                "color", Map.of("rgba", pathColor)
//                                            )
//                                    ),
//                        "width", 5,
//                        "leadTime", 1000,
//                        "trailTime", 1000,
//                        "resolution", 5
//                        ),
//                        "position", Map.of(
//                                "epoch", startTime.toString(),
//                                "interpolationAlgorithm", "LINEAR",
//                                "interpolationDegree", 2,
//                                "cartesian", positions
//                        )
//                ));

                // 좌표 변환
                double lon = path.get(0).getX();
                double lat = path.get(0).getY();
                double height = path.get(0).getZ();
                vehiclePath.add(path);


                vehicleDataList.add(new Vehicle(vehicleId, Cartesian3.fromDegrees(lon, lat, height), false));
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("czml", czml);
        response.put("newVehicleData", vehicleDataList);
        response.put("positions", vehiclePath);

        return ResponseEntity.ok(response);
    }
    /**
     *  - "czml" 대신 GeoJSON FeatureCollection을 반환.
     *  - 각 Feature의 properties에 "timePositions" 배열을 담아, 시간 흐름에 따른 (x, y, z) 좌표를 기록.
     *  - geometry는 LineString으로, [lon, lat, height]를 전부 담아서 경로 표시도 가능하게 함.
     *  - "newVehicleData", "positions" 등은 [generateCzml]과 동일하게 함께 반환.
     */
    @PostMapping("/generate-features")
    public ResponseEntity<Map<String, Object>> generateFeature(@RequestBody VehicleRequest request) {
        List<Vehicle> vehicleDataList = new ArrayList<>();
        List<List<Cartesian3>> vehiclePathList = new ArrayList<>();

        // 기본 FeatureCollection 구조
        Map<String, Object> featureCollection = new HashMap<>();
        featureCollection.put("type", "FeatureCollection");
        List<Map<String, Object>> featureList = new ArrayList<>();

        Network network = networkRepository.findById(1L).orElse(null);
        if (network == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Network data not found"));
        }

        List<Road> roadEntities = GeoJsonUtils.parseGeoJsonToRoads(network.getGeojson());
        Map<Cartesian3, List<Road>> roadConnections = buildRoadConnections(roadEntities);

        Random random = new Random();

        for (int i = 0; i < request.getNumVehicle(); i++) {
            Road startRoad = roadEntities.get(random.nextInt(roadEntities.size()));
            List<Cartesian3> path = buildConnectedPath(startRoad, roadConnections, 2);
            if (path == null || path.isEmpty()) {
                continue;
            }

            // (A) geometry.coordinates: [ [lon, lat, height], ... ]
            List<List<Double>> lineCoordinates = new ArrayList<>();
            // (B) times: 인덱스별 시간(초)
            List<Double> times = new ArrayList<>();

            Instant startTime = Instant.now();
            for (int j = 0; j < path.size(); j++) {
                // coords
                Cartesian3 pos = path.get(j);
                lineCoordinates.add(Arrays.asList(pos.getX(), pos.getY(), pos.getZ()));

                // times
                Instant thisTime = startTime.plusSeconds(j * request.getSpeedFactor());
                double t = Duration.between(startTime, thisTime).getSeconds();
                times.add(t);
            }

            // LineString geometry
            Map<String, Object> geometry = new HashMap<>();
            geometry.put("type", "LineString");
            geometry.put("coordinates", lineCoordinates);

            // properties
            String vehicleId = "vehicle" + i;
            Map<String, Object> props = new HashMap<>();
            props.put("id", vehicleId);
            props.put("times", times); // 여기에는 시간만 기록

            Map<String, Object> feature = new HashMap<>();
            feature.put("type", "Feature");
            feature.put("geometry", geometry);
            feature.put("properties", props);
            featureList.add(feature);

            // 기존 vehicleDataList / positions
            double lon = path.get(0).getX();
            double lat = path.get(0).getY();
            double height = path.get(0).getZ();
            vehiclePathList.add(path);

            vehicleDataList.add(new Vehicle(vehicleId, Cartesian3.fromDegrees(lon, lat, height), false));
        }

        featureCollection.put("features", featureList);

        Map<String, Object> response = new HashMap<>();
        response.put("features", featureCollection);
        response.put("newVehicleData", vehicleDataList);
        response.put("positions", vehiclePathList);

        return ResponseEntity.ok(response);
    }

    /**
     *  Cesium용 "czml" OpenLayers용 "features" 통합
     *  공통 "positions", "newVehicleData"를 한 번에 생성해 반환.
     */
    @PostMapping("/generate-vehicle-route")
    public ResponseEntity<Map<String, Object>> generateVehicleRoute(@RequestBody VehicleRequest request) throws IOException {

        // 네트워크 및 도로 데이터 로드
        Network network = networkRepository.findById(4L).orElse(null);
        if (network == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Network data not found"));
        }

        List<Road> roadEntities = GeoJsonUtils.parseGeoJsonToRoads(network.getGeojson());
        Map<String, Road> roadMap = roadEntities.stream().collect(Collectors.toMap(
                road -> road.getLinkId() + "|" + road.getLaneId(),
                Function.identity(),
                (r1, r2) -> r1
        ));

        //List<VehicleState> allVehicles = vehicleDataReader.readLimited(request.getNumVehicle());
        //Map<String, List<VehicleState>> grouped = allVehicles.stream()
        //        .collect(Collectors.groupingBy(VehicleState::getId));

        Map<String, List<VehicleState>> grouped = vehicleDataReader.readLimited(request.getNumVehicle()).stream()
                .collect(Collectors.groupingBy(VehicleState::getId));

        List<Map<String, Object>> czml = new ArrayList<>();
        List<Map<String, Object>> featureList = new ArrayList<>();
        List<Vehicle> vehicleDataList = new ArrayList<>();
        List<List<Double>> vehiclePathList = new ArrayList<>();

        Instant startTime = Instant.now();
        ConcurrentHashMap<String, CoordinateConverter> converterCache = new ConcurrentHashMap<>();

        AtomicReference<Instant> earliestStartRef = new AtomicReference<>(null);
        AtomicReference<Instant> latestStopRef = new AtomicReference<>(null);

        grouped.entrySet().parallelStream().forEach(entry -> {
            String vehicleId = entry.getKey();
            List<VehicleState> vehicles = entry.getValue();

            if (vehicles.isEmpty()) return;

            double firstTimeStep = vehicles.get(0).getTimestep();
            double lastTimeStep = vehicles.get(vehicles.size() - 1).getTimestep();

            Instant vehicleStartTime = startTime.plusSeconds((long) firstTimeStep);
            Instant vehicleStopTime = startTime.plusSeconds((long) lastTimeStep);

            if (earliestStartRef.get() == null || vehicleStartTime.isBefore(earliestStartRef.get())) {
                earliestStartRef.set(vehicleStartTime);
            }
            if (latestStopRef.get() == null || vehicleStopTime.isAfter(latestStopRef.get())) {
                latestStopRef.set(vehicleStopTime);
            }

            List<Map.Entry<Double, Cartesian3>> path = new ArrayList<>();
            List<Cartesian3> path2d = new ArrayList<>();

            vehicles.forEach(vehicle -> {
                String linkId = vehicle.getLinkId();
                String laneId = vehicle.getLaneId();
                String key = linkId + "|" + laneId;

                Road baseRoad = roadMap.get(key);
                if (baseRoad == null) return;

                CoordinateConverter converter = converterCache.computeIfAbsent(key, k -> {
                    CoordinateConverter c = new CoordinateConverter();
                    c.setBasePoint(baseRoad.getBaseLon(), baseRoad.getBaseLat());
                    return c;
                });

                ProjCoordinate actualCoord = converter.toAbsolute(vehicle.getPosX(), vehicle.getPosY());
                Cartesian3 position = Cartesian3.fromDegrees(actualCoord.x, actualCoord.y, 0);

                synchronized (this) {
                    path.add(Map.entry(vehicle.getTimestep(), position));
                    path2d.add(new Cartesian3(actualCoord.x, actualCoord.y, 0.0));
                }
            });

            if (path2d.isEmpty()) return;

            synchronized (this) {
                //vehiclePathList.add(path2d);

                Cartesian3 startPos = path2d.get(0);
                vehicleDataList.add(new Vehicle(vehicleId, Cartesian3.fromDegrees(startPos.getX(), startPos.getY(), 0), false));

                List<Double> cartesianArray = new ArrayList<>();
                path.forEach(entryPoint -> {
                    cartesianArray.add(entryPoint.getKey());
                    Cartesian3 pos = entryPoint.getValue();
                    cartesianArray.add(pos.getX());
                    cartesianArray.add(pos.getY());
                    cartesianArray.add(pos.getZ());
                });

                double firstTime = path.get(0).getKey();
                double lastTime = path.get(path.size() - 1).getKey();

                Instant vehicleStart = startTime.plusSeconds((long) firstTime);
                Instant vehicleStop = startTime.plusSeconds((long) lastTime);

                czml.add(Map.of(
                        "id", vehicleId,
                        "availability", vehicleStart.toString() + "/" + vehicleStop.toString(),
                        "position", Map.of(
                                "epoch", startTime.toString(),
                                "interpolationAlgorithm", "HERMITE",
                                "interpolationDegree", 2,
                                "cartesian", cartesianArray
                        ),
                        "orientation", Map.of("velocityReference", "#position")
                ));

                vehiclePathList.add(cartesianArray);

                List<List<Double>> lineCoordinates = path2d.stream()
                        .map(p -> Arrays.asList(p.getX(), p.getY(), p.getZ()))
                        .collect(Collectors.toList());

                List<List<Double>> positionsInterval = path.stream()
                        .map(p -> List.of(p.getKey()))
                        .collect(Collectors.toList());

                featureList.add(Map.of(
                        "geometry", Map.of(
                                "type", "LineString",
                                "coordinates", lineCoordinates
                        ),
                        "properties", Map.of(
                                "id", vehicleId,
                                "availability", vehicleStart.toString() + "/" + vehicleStop.toString(),
                                "positionsInterval", positionsInterval
                        )
                ));
            }
        });

        Instant globalStart = earliestStartRef.get();
        Instant globalStop = latestStopRef.get();

        Map<String, Object> documentPacket = Map.of(
                "id", "document",
                "name", "Vehicle Movement",
                "version", "1.0",
                "clock", Map.of(
                        "interval", globalStart.toString() + "/" + globalStop.toString(),
                        "currentTime", globalStart.toString(),
                        "multiplier", 1,
                        "range", "CLAMPED",
                        "step", "SYSTEM_CLOCK_MULTIPLIER"
                )
        );

        czml.add(0, documentPacket);

        Map<String, Object> response = new HashMap<>();
        response.put("czml", czml);
        response.put("features", featureList);
        response.put("positions", vehiclePathList);
        response.put("newVehicleData", vehicleDataList);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/generate-vehicle")
    public ResponseEntity<Map<String, Object>> generateVehicle(@RequestBody VehicleRequest request) {
        List<List<Double>> vehiclePath = new ArrayList<>();
        List<Vehicle> vehicleDataList = new ArrayList<>();

        Network network = networkRepository.findById(1L).orElse(null);

        if (network == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Network data not found"));
        }

        // GeoJSON을 Road 리스트로 변환
        List<Road> roadEntities = GeoJsonUtils.parseGeoJsonToRoads(network.getGeojson());


        Random random = new Random();
        for (int i = 0; i < request.getNumVehicle(); i++) {
            Road road = roadEntities.get(random.nextInt(roadEntities.size()));
            List<Cartesian3> path = road.getPolyline().getPositions();

            if (path != null && !path.isEmpty()) {
                List<Double> positions = new ArrayList<>();
                Instant startTime = Instant.now();
                Instant stopTime = startTime.plusSeconds(100000);

                for (int j = 0; j < path.size(); j++) {
                    Instant time = startTime.plusSeconds(j * request.getSpeedFactor());
                    positions.add((double) Duration.between(startTime, time).getSeconds());
                    Cartesian3 cartesian3 = Cartesian3.fromDegrees(path.get(j).getX(), path.get(j).getY(), path.get(j).getZ());
                    positions.add(cartesian3.getX());
                    positions.add(cartesian3.getY());
                    positions.add(cartesian3.getZ());
                }

                String vehicleId = "vehicle" + i;

                // 좌표 변환
                double lon = path.get(0).getX();
                double lat = path.get(0).getY();
                double height = path.get(0).getZ();
                vehiclePath.add(Arrays.asList(lon, lat, height));

                vehicleDataList.add(new Vehicle(vehicleId, Cartesian3.fromDegrees(lon, lat, height), false));
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("positions", vehiclePath);
        response.put("newVehicleData", vehicleDataList);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/generate-positions")
    public ResponseEntity<Map<String, Object>> generatePositions(@RequestBody VehicleRequest request) {
        List<List<Cartesian3>> vehiclePath = new ArrayList<>();

        Network network = networkRepository.findById(1L).orElse(null);

        if (network == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Network data not found"));
        }

        // GeoJSON을 Road 리스트로 변환
        List<Road> roadEntities = GeoJsonUtils.parseGeoJsonToRoads(network.getGeojson());

        Map<Cartesian3, List<Road>> roadConnections = buildRoadConnections(roadEntities);


        Random random = new Random();
        for (int i = 0; i < request.getNumVehicle(); i++) {
            Road startRoad = roadEntities.get(random.nextInt(roadEntities.size())); // 랜덤 도로 선택
            List<Cartesian3> path = buildConnectedPath(startRoad, roadConnections, 2);

            if (path != null && !path.isEmpty()) {
                List<Cartesian3> positions = new ArrayList<>();

                // 차량의 이동 속도에 따라 경로를 일정한 거리 간격으로 나누기
                double totalDistance = 0.0;

                // 전체 경로의 총 거리를 계산
                for (int j = 0; j < path.size() - 1; j++) {
                    totalDistance += calculateDistance(path.get(j), path.get(j + 1)); // 두 점 사이의 거리
                }

                // 목표 거리 간격 (차량의 속도에 맞춰 거리 계산)
                double targetDistance = totalDistance / request.getSpeedFactor(); // SpeedFactor에 맞게 분배
                double currentDistance = 0.0;

                //positions.add(path.get(0)); // 경로의 첫 번째 위치를 시작점으로 추가

                for (int j = 1; j < path.size(); j++) {
                    Cartesian3 start = path.get(j - 1);
                    Cartesian3 end = path.get(j);

                    double segmentDistance = calculateDistance(start, end);
                    currentDistance += segmentDistance;

                    // 일정 거리마다 점을 추가
                    while (currentDistance >= targetDistance) {
                        // 두 점 사이의 방향 벡터를 정규화하여 위치 계산
                        double ratio = (currentDistance - targetDistance) / segmentDistance;
                        double lon = start.getX() + ratio * (end.getX() - start.getX());
                        double lat = start.getY() + ratio * (end.getY() - start.getY());
                        double alt = start.getZ() + ratio * (end.getZ() - start.getZ());

                        // 새로운 점을 계산하여 추가
                        positions.add(Cartesian3.fromDegrees(lon, lat, alt));

                        currentDistance -= targetDistance; // 이동된 거리를 차감
                    }
                }
                vehiclePath.add(positions);
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("positions", vehiclePath);

        return ResponseEntity.ok(response);
    }

    // 두 점 사이의 거리를 계산하는 메서드
//    private double calculateDistance(Cartesian3 point1, Cartesian3 point2) {
//
//        double deltaX = point2.getX() - point1.getX();
//        double deltaY = point2.getY() - point1.getY();
//        double deltaZ = point2.getZ() - point1.getZ();
//        return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ); // 3D 거리 계산
//    }

    private double toRadians(double degree) {
        return degree * Math.PI / 180;
    }

    private double calculateDistance(Cartesian3 point1, Cartesian3 point2) {
        final double R = 6371; // 지구의 반지름 (단위: 킬로미터)

        // 위도 및 경도를 라디안으로 변환
        double deltaLat = toRadians(point2.getX() - point1.getX());
        double deltaLon = toRadians(point2.getY() - point1.getY());

        // Haversine 공식
        double a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                Math.cos(toRadians(point1.getY())) * Math.cos(toRadians(point2.getY())) *
                        Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        // 두 점 사이의 거리
        return R * c; // 거리 단위: 킬로미터
    }

    // 도로 연결 관계를 맵으로 생성
    private Map<Cartesian3, List<Road>> buildRoadConnections(List<Road> roads) {
        Map<Cartesian3, List<Road>> roadConnections = new HashMap<>();

        for (Road road : roads) {
            List<Cartesian3> positions = road.getPolyline().getPositions();
            Cartesian3 start = positions.get(0);
            Cartesian3 end = positions.get(positions.size() - 1);

            roadConnections.putIfAbsent(start, new ArrayList<>());
            roadConnections.putIfAbsent(end, new ArrayList<>());

            roadConnections.get(start).add(road);
            roadConnections.get(end).add(road);
        }
        return roadConnections;
    }

    // minLength 이상이 되도록 연속 도로를 연결하여 경로 생성
    private List<Cartesian3> buildConnectedPath(Road startRoad, Map<Cartesian3, List<Road>> roadConnections, double minLength) {
        List<Cartesian3> fullPath = new ArrayList<>(startRoad.getPolyline().getPositions());
        Set<Road> visited = new HashSet<>();
        visited.add(startRoad);

        double totalLength = calculateRoadLength(startRoad);
        Cartesian3 currentEnd = fullPath.get(fullPath.size() - 1);

        while (totalLength < minLength) {
            List<Road> possibleRoads = roadConnections.getOrDefault(currentEnd, Collections.emptyList())
                    .stream()
                    .filter(road -> !visited.contains(road))
                    .collect(Collectors.toList());

            if (possibleRoads.isEmpty()) break; // 연결 가능한 도로가 없으면 종료

            // 가장 긴 도로를 선택 (연결이 빨리 끝나도록)
            Road nextRoad = possibleRoads.stream()
                    .max(Comparator.comparingDouble(this::calculateRoadLength))
                    .orElse(null);

            if (nextRoad == null) break;

            visited.add(nextRoad);
            List<Cartesian3> nextPositions = nextRoad.getPolyline().getPositions();

            // 방향 일치 여부 확인 후 추가
            if (currentEnd.equals(nextPositions.get(0))) {
                fullPath.addAll(nextPositions.subList(1, nextPositions.size()));
            } else {
                Collections.reverse(nextPositions);
                fullPath.addAll(nextPositions.subList(1, nextPositions.size()));
            }

            totalLength += calculateRoadLength(nextRoad);
            currentEnd = fullPath.get(fullPath.size() - 1);
        }

        return totalLength >= minLength ? fullPath : null;
    }

    // 도로의 길이 계산
    private double calculateRoadLength(Road road) {
        List<Cartesian3> positions = road.getPolyline().getPositions();
        double length = 0.0;

        for (int i = 1; i < positions.size(); i++) {
            length += calculateDistance(positions.get(i - 1), positions.get(i));
        }

        return length;
    }

    // 두 점 사이의 거리 계산 (Cartesian3)
//    private double calculateDistance(Cartesian3 p1, Cartesian3 p2) {
//        return Math.sqrt(
//                Math.pow(p2.getX() - p1.getX(), 2) +
//                        Math.pow(p2.getY() - p1.getY(), 2) +
//                        Math.pow(p2.getZ() - p1.getZ(), 2)
//        );
//    }



}