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
import com.iitp.iitp_rest.util.VehicleParserUtil;
import lombok.AllArgsConstructor;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/vehicle")
@AllArgsConstructor
public class VehicleController {

    private final NetworkRepository networkRepository;

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

        Network network = networkRepository.findById(2L).orElse(null);

        if (network == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Network data not found"));
        }

        List<Road> roadEntities = GeoJsonUtils.parseGeoJsonToRoads(network.getGeojson());

        Map<Cartesian3, List<Road>> roadConnections = buildRoadConnections(roadEntities);

        ClassPathResource visualizerResource = new ClassPathResource("xmls/VehicleEventVisualizer.xml");
        InputStream visualizerStream = visualizerResource.getInputStream();
        List<VehicleState> allVehicles = VehicleParserUtil.parseVisualizer(visualizerStream);
        Map<String, List<VehicleState>> grouped = allVehicles.stream()
                .collect(Collectors.groupingBy(VehicleState::getId));

        List<Map<String, Object>> czml = new ArrayList<>();
        List<Map<String, Object>> featureList = new ArrayList<>();
        List<Vehicle> vehicleDataList = new ArrayList<>();
        List<List<Cartesian3>> vehiclePathList = new ArrayList<>();

        czml.add(Map.of(
                "id", "document",
                "name", "Vehicle Movement",
                "version", "1.0"
        ));

        CoordinateConverter coordinateConverter = new CoordinateConverter();
        int numVehicle = request.getNumVehicle();
        Instant startTime = Instant.now();

        Instant earliestStart = null;
        Instant latestStop = null;

        for (Map.Entry<String, List<VehicleState>> entry : grouped.entrySet()) {
            List<VehicleState> vehicles = entry.getValue();
            if (vehicles.isEmpty()) continue;

            double firstTimeStep = vehicles.get(0).getTimestep();
            double lastTimeStep = vehicles.get(vehicles.size() - 1).getTimestep();

            Instant vehicleStart = startTime.plusSeconds((long) firstTimeStep);
            Instant vehicleStop = startTime.plusSeconds((long) lastTimeStep);

            if (earliestStart == null || vehicleStart.isBefore(earliestStart)) {
                earliestStart = vehicleStart;
            }
            if (latestStop == null || vehicleStop.isAfter(latestStop)) {
                latestStop = vehicleStop;
            }
        }

        Map<String, Object> clock = new HashMap<>();
        clock.put("id", "document");
        clock.put("version", "1.0");
        clock.put("clock", Map.of(
                "interval", earliestStart.toString() + "/" + latestStop.toString(),
                "currentTime", earliestStart.toString(),
                "multiplier", 1,
                "range", "CLAMPED"
        ));
        czml.add(clock);

        int vehicleCount = 0;
        for (Map.Entry<String, List<VehicleState>> entry : grouped.entrySet()) {
            if (vehicleCount >= numVehicle) break;
            String vehicleId = entry.getKey();
            List<VehicleState> vehicles = entry.getValue();

            List<Map.Entry<Double, Cartesian3>> path = new ArrayList<>();
            List<Cartesian3> path2d = new ArrayList<>();

            for (VehicleState vehicle : vehicles) {
                String linkId = vehicle.getLinkId();
                String laneId = vehicle.getLaneId();

                List<Road> matchedRoads = roadEntities.stream()
                        .filter(road -> linkId.equals(road.getLinkId()) && laneId.equals(road.getLaneId()))
                        .collect(Collectors.toList());

                if (matchedRoads.isEmpty()) {
                    System.out.println("No matched road for linkId: " + linkId + ", laneId: " + laneId);
                    continue;
                }

                Road baseRoad = matchedRoads.get(0);
                coordinateConverter.setBasePoint(baseRoad.getBaseLon(), baseRoad.getBaseLat());

                double relativeX = vehicle.getPosX();
                double relativeY = vehicle.getPosY();
                ProjCoordinate actualCoord = coordinateConverter.toAbsolute(relativeX, relativeY);

                double timeStep = vehicle.getTimestep();
                Cartesian3 position = Cartesian3.fromDegrees(actualCoord.x, actualCoord.y, 0);

                path.add(new AbstractMap.SimpleEntry<>(timeStep, position));
                path2d.add(new Cartesian3(actualCoord.x, actualCoord.y, 0.0));
            }

            if (path2d.isEmpty()) continue;

            vehiclePathList.add(path2d);

            double lonStart = path2d.get(0).getX();
            double latStart = path2d.get(0).getY();
            vehicleDataList.add(new Vehicle(vehicleId, Cartesian3.fromDegrees(lonStart, latStart, 0), false));

            List<Double> cartesianArray = new ArrayList<>();

            double elapsedSeconds = 0.0;

            for (Map.Entry<Double, Cartesian3> pathEntry : path) {
                elapsedSeconds = pathEntry.getKey();
                Cartesian3 current = pathEntry.getValue();
                cartesianArray.add(elapsedSeconds);
                cartesianArray.add(current.getX());
                cartesianArray.add(current.getY());
                cartesianArray.add(current.getZ());
            }

            double firstTimeStep = path.get(0).getKey();
            double lastTimeStep = path.get(path.size() - 1).getKey();
            Instant vehicleStart = startTime.plusSeconds((long) firstTimeStep);
            Instant vehicleStop = startTime.plusSeconds((long) lastTimeStep);

            Map<String, Object> czmlObj = new HashMap<>();
            czmlObj.put("id", vehicleId);

            Map<String, Object> position = new HashMap<>();
            position.put("epoch", startTime.toString());
            position.put("interpolationAlgorithm", "LINEAR");
            position.put("interpolationDegree", 2);
            position.put("cartesian", cartesianArray);
            czmlObj.put("position", position);

            czmlObj.put("availability", vehicleStart.toString() + "/" + vehicleStop.toString());
            czmlObj.put("orientation", Map.of("velocityReference", "#position"));

            czml.add(czmlObj);

            List<List<Double>> lineCoordinates = path2d.stream()
                    .map(p -> Arrays.asList(p.getX(), p.getY(), p.getZ()))
                    .collect(Collectors.toList());

            Map<String, Object> geometry = new HashMap<>();
            geometry.put("type", "LineString");
            geometry.put("coordinates", lineCoordinates);

            List<List<Double>> positionsInterval = new ArrayList<>();
            for (Map.Entry<Double, Cartesian3> pathEntry : path) {
                double seconds = pathEntry.getKey();
                positionsInterval.add(Arrays.asList(seconds));
            }

            Map<String, Object> properties = new HashMap<>();
            properties.put("id", vehicleId);
            properties.put("availability", vehicleStart.toString() + "/" + vehicleStop.toString());
            properties.put("positionsInterval", positionsInterval);

            Map<String, Object> feature = new HashMap<>();
            feature.put("geometry", geometry);
            feature.put("properties", properties);

            featureList.add(feature);

            vehicleCount++;
        }

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

            //System.out.println(roadConnections);
            System.out.println(startRoad);

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
                System.out.println(i);
                System.out.println(totalDistance);
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