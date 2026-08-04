package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.analytics.CongestionGraphResponse;
import com.iitp.iitp_rest.model.analytics.FacilityCoverageResponse;
import com.iitp.iitp_rest.model.analytics.IntersectionLosResponse;
import com.iitp.iitp_rest.model.analytics.LaneTrafficResponse;
import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
import com.iitp.iitp_rest.model.analytics.LinkTrafficResponse;
import com.iitp.iitp_rest.model.analytics.OdFlowResponse;
import com.iitp.iitp_rest.model.analytics.OverallSummaryResponse;
import com.iitp.iitp_rest.model.analytics.RegionBoundary;
import com.iitp.iitp_rest.model.analytics.RegionOdGraphResponse;
import com.iitp.iitp_rest.model.analytics.RegionTrafficResponse;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.link.SimType;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.signal.SignalResponse;
import com.iitp.iitp_rest.service.analytics.AdminBoundaryService;
import com.iitp.iitp_rest.service.analytics.IsochroneService;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationService;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationService;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.signal.SignalTileService;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.PolygonBoundaryUtils;
import com.iitp.iitp_rest.util.TrafficMetricsUtil;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/analytics")
@AllArgsConstructor
public class AnalyticsController {

    private final VehicleDataReader vehicleDataReader;
    private final NetworkTileService networkTileService;
    private final ScenarioService scenarioService;
    private final SignalTileService signalTileService;
    private final AdminBoundaryService adminBoundaryService;
    private final IsochroneService isochroneService;
    private final BusStationService busStationService;
    private final RailStationService railStationService;

    /** OD 흐름 집계 시 선별 차량 상한 — 개별 표시가 아니라 격자 집계 표본이라 낮게 잡아도 된다 */
    private static final int OD_FLOW_MAX_VEHICLES = 3000;
    /** OD 격자 크기 (도, ≈1.1km) — 프론트 makeOdDataWorker(개별 차량 근거리용)와 동일 크기 공유 */
    private static final double OD_FLOW_GRID_DEG = 0.01;

    /**
     * 링크별 교통량 통계 API
     *
     * @param versionId 시나리오 버전 ID
     * @param interval  시간 집계 단위 (초, 기본값 60)
     * @param topN      상위 링크 개수 (기본값 10)
     */
    @GetMapping("/link-stats/{versionId}")
    public ResponseEntity<LinkStatsResponse> getLinkStats(
            @PathVariable String versionId,
            @RequestParam(defaultValue = "60") int interval,
            @RequestParam(defaultValue = "10") int topN) {

        LinkStatsResponse stats = vehicleDataReader.readLinkStats(versionId, interval, topN);
        return ResponseEntity.ok(stats);
    }

    /**
     * bbox + 시간창 내 링크별 교통량 집계 (차량 overview LOD — 멀리서 전체 교통량).
     * 개별 차량 대신 링크별 volume/avgSpeed 만 내려 히트맵으로 표시. 메모리 무관(백엔드 GROUP BY).
     *
     * @param bbox     "west,south,east,north" (WGS84). 이 영역의 네트워크 링크만 집계.
     * @param fromTime 시간창 시작(초), toTime 끝(초). 미지정(0,0) 시 전체 시간.
     */
    @GetMapping("/link-traffic/{versionId}")
    public ResponseEntity<LinkTrafficResponse> getLinkTraffic(
            @PathVariable String versionId,
            @RequestParam String bbox,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime) {
        try {
            double[] b = parseBbox(bbox);
            if (b == null) return ResponseEntity.badRequest().build();

            // 1) bbox 내 링크 id 목록 (네트워크 RTree 재사용 — overview lod 로 간선 위주)
            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, b[0], b[1], b[2], b[3], NetworkTileService.Lod.MID);
            List<String> linkIds = new ArrayList<>();
            Map<String, LinkResponse> linkById = new HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) {
                    String id = String.valueOf(l.getId());
                    linkIds.add(id);
                    linkById.put(id, l);
                }
            }

            // 2) 차량 SQLite 에서 그 링크들의 집계 (fromTime=toTime=0 이면 결과에 실제 관측 구간이 채워짐)
            LinkTrafficResponse result = vehicleDataReader.readLinkTraffic(versionId, linkIds, fromTime, toTime);

            // 3) 좌표 동봉 + 혼잡도(V/C)·LOS 계산
            applyLinkMetrics(result, linkById);
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] link-traffic 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * bbox + 시간창 내 레인별 교통량 집계 — 메조 링크 레인/커넥션 색칠 전용(프론트가 마이크로/
     * 메조 구분은 이미 보유한 network 데이터로 직접 필터링하므로, 여기서도 메조 링크만 대상으로
     * 좁혀 응답 크기·쿼리 범위를 줄인다). link-traffic과 동일 골격, GROUP BY만 레인 단위.
     */
    @GetMapping("/lane-traffic/{versionId}")
    public ResponseEntity<LaneTrafficResponse> getLaneTraffic(
            @PathVariable String versionId,
            @RequestParam String bbox,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime) {
        try {
            double[] b = parseBbox(bbox);
            if (b == null) return ResponseEntity.badRequest().build();

            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, b[0], b[1], b[2], b[3], NetworkTileService.Lod.MID);
            List<String> linkIds = new ArrayList<>();
            Map<String, LinkResponse> linkById = new HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() == null || l.getSimType() == SimType.Micro) continue;
                String id = String.valueOf(l.getId());
                linkIds.add(id);
                linkById.put(id, l);
            }

            LaneTrafficResponse result = vehicleDataReader.readLaneTraffic(versionId, linkIds, fromTime, toTime);
            applyLaneMetrics(result, linkById);
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] lane-traffic 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * bbox 내 신호교차로별 서비스수준(LOS) 근사 — 접근 링크(그 노드로 향하는 링크)들의
     * V/C 기반 losGrade 중 최악값을 교차로 등급으로 채택한다.
     *
     * @param bbox     "west,south,east,north" (WGS84)
     * @param fromTime 시간창 시작(초), toTime 끝(초). 미지정(0,0) 시 전체 시간.
     */
    @GetMapping("/intersection-los/{versionId}")
    public ResponseEntity<IntersectionLosResponse> getIntersectionLos(
            @PathVariable String versionId,
            @RequestParam String bbox,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime) {
        try {
            double[] b = parseBbox(bbox);
            if (b == null) return ResponseEntity.badRequest().build();

            // NEAR 이상이어야 net.getNodes()가 채워진다(NetworkTileService: includeNodes =
            // lod==NEAR||DETAIL) — 노드 좌표가 필요해 link-traffic과 달리 MID를 쓸 수 없다.
            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, b[0], b[1], b[2], b[3], NetworkTileService.Lod.NEAR);
            List<String> linkIds = new ArrayList<>();
            Map<String, LinkResponse> linkById = new HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) {
                    String id = String.valueOf(l.getId());
                    linkIds.add(id);
                    linkById.put(id, l);
                }
            }

            LinkTrafficResponse traffic = vehicleDataReader.readLinkTraffic(versionId, linkIds, fromTime, toTime);
            applyLinkMetrics(traffic, linkById);

            // 신호가 있는 노드 id 집합 (신호는 네트워크 노드에 종속 — 같은 bbox 재사용)
            List<SignalResponse> signals = signalTileService.queryByBbox(versionId, b[0], b[1], b[2], b[3]);
            Set<String> signalNodeIds = signals.stream()
                    .map(SignalResponse::getNodeId)
                    .filter(java.util.Objects::nonNull)
                    .collect(Collectors.toSet());

            Map<String, NodeResponse> nodeById = new HashMap<>();
            for (NodeResponse n : net.getNodes()) {
                if (n.getId() != null) nodeById.put(String.valueOf(n.getId()), n);
            }

            // 접근 링크(toNode 기준)를 신호 노드별로 그룹핑, 최악 등급 채택
            Map<String, List<String>> gradesByNode = new HashMap<>();
            for (LinkTrafficResponse.LinkTraffic lt : traffic.getLinks()) {
                if (lt.getLosGrade() == null || lt.getToNode() == null) continue;
                String nodeId = String.valueOf(lt.getToNode());
                if (!signalNodeIds.contains(nodeId)) continue;
                gradesByNode.computeIfAbsent(nodeId, k -> new ArrayList<>()).add(lt.getLosGrade());
            }

            IntersectionLosResponse out = new IntersectionLosResponse();
            for (Map.Entry<String, List<String>> e : gradesByNode.entrySet()) {
                NodeResponse node = nodeById.get(e.getKey());
                if (node == null || node.getCoordinates() == null) continue;
                String worst = e.getValue().stream().max(String::compareTo).orElse(null); // "A"<"F" 알파벳순 = 등급순
                out.getIntersections().add(new IntersectionLosResponse.IntersectionLos(
                        e.getKey(), node.getCoordinates().getLng(), node.getCoordinates().getLat(),
                        worst, e.getValue().size()));
            }
            return ResponseEntity.ok(out);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] intersection-los 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** "west,south,east,north" 파싱. 형식 오류 시 null. */
    private double[] parseBbox(String bbox) {
        String[] p = bbox.split(",");
        if (p.length != 4) return null;
        return new double[]{
                Double.parseDouble(p[0].trim()), Double.parseDouble(p[1].trim()),
                Double.parseDouble(p[2].trim()), Double.parseDouble(p[3].trim())
        };
    }

    /**
     * 링크 중심선 좌표 동봉 + 혼잡도(V/C)·LOS 계산을 결과에 채운다.
     * 네트워크 타일 모드에서 클라이언트가 전체 링크 지오메트리를 보유하지 않으므로 좌표를 함께 내린다.
     */
    private void applyLinkMetrics(LinkTrafficResponse result, Map<String, LinkResponse> linkById) {
        int windowSeconds = result.getToTime() - result.getFromTime();
        for (LinkTrafficResponse.LinkTraffic lt : result.getLinks()) {
            LinkResponse link = linkById.get(lt.getLinkId());
            if (link == null) continue;
            lt.setCoordinates(link.getCoordinates());
            lt.setFromNode(link.getFromNode());
            lt.setToNode(link.getToNode());
            lt.setCapacity(link.getQmax());
            double vc = TrafficMetricsUtil.vcRatio(lt.getVolume(), windowSeconds, link.getQmax());
            lt.setVcRatio(vc);
            lt.setLosGrade(TrafficMetricsUtil.losGrade(vc));
        }
    }

    /**
     * 레인 혼잡도(V/C)·LOS 계산 — applyLinkMetrics의 레인 단위 버전. 레인별 capacity가 따로
     * 없어 링크 capacity(qmax) ÷ 레인 수로 근사한다(각 레인이 균등하게 용량을 나눠 가진다는
     * 단순화 — 실제 차로별 용량 차이는 반영 못 함, 데모/시각화 목적에선 충분).
     */
    private void applyLaneMetrics(LaneTrafficResponse result, Map<String, LinkResponse> linkById) {
        int windowSeconds = result.getToTime() - result.getFromTime();
        for (LaneTrafficResponse.LaneTraffic lt : result.getLanes()) {
            LinkResponse link = linkById.get(lt.getLinkId());
            if (link == null || link.getNumLane() <= 0) continue;
            double laneCapacity = link.getQmax() / link.getNumLane();
            lt.setCapacity(laneCapacity);
            double vc = TrafficMetricsUtil.vcRatio(lt.getVolume(), windowSeconds, laneCapacity);
            lt.setVcRatio(vc);
            lt.setLosGrade(TrafficMetricsUtil.losGrade(vc));
        }
    }

    /**
     * bbox + 시간창 내 차량들의 origin/destination 흐름 집계 (차량 overview LOD — 가장 축소된
     * 단계, 히트맵보다도 더 멀리서 사용). 각 차량의 시간창 내 첫/마지막 위치를 격자(≈1.1km)로
     * 스냅해 (origin격자,destination격자) 쌍별로 집계 — 개별 차량 좌표 대신 화살표 굵기(volume)로
     * 흐름만 표시. link-traffic과 동일하게 메모리에 개별 차량을 들지 않고 백엔드가 집계한다.
     *
     * @param bbox     "west,south,east,north" (WGS84)
     * @param fromTime 시간창 시작(초), toTime 끝(초). 미지정(0,0) 시 전체 시간.
     * @param maxPairs 반환할 상위 OD 쌍 개수 (기본 100, volume 내림차순)
     */
    @GetMapping("/od-flow/{versionId}")
    public ResponseEntity<OdFlowResponse> getOdFlow(
            @PathVariable String versionId,
            @RequestParam String bbox,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime,
            @RequestParam(defaultValue = "100") int maxPairs) {
        try {
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            Scenario scenario = scenarioService.getScenarioByKey(versionId);
            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }
            double rotation = scenario.getBaseRotation() != null ? scenario.getBaseRotation() : 0.0;
            double scale = scenario.getBaseScale() != null ? scenario.getBaseScale() : 1.0;

            // 1) bbox 내 링크 id 목록 (link-traffic과 동일 — 네트워크 RTree 재사용)
            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, west, south, east, north, NetworkTileService.Lod.MID);
            List<String> linkIds = new ArrayList<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) linkIds.add(String.valueOf(l.getId()));
            }

            // 2) 선별 차량들의 시간창 내 첫/끝 로컬 좌표 (변환 전)
            List<VehicleDataReader.VehicleOd> vehOds = vehicleDataReader.readVehicleFirstLastPositions(
                    versionId, linkIds, fromTime, toTime, OD_FLOW_MAX_VEHICLES);

            // 3) 로컬→위경도 변환 후 격자 스냅, (origin격자,destination격자) 쌍별 집계
            Map<String, Integer> counts = new HashMap<>();
            Map<String, double[]> coordsByKey = new HashMap<>();
            for (VehicleDataReader.VehicleOd od : vehOds) {
                ProjCoordinate fromGeo = CoordinateConverter.toAbsoluteLocal(
                        od.fromX(), od.fromY(), scenario.getLongitude(), scenario.getLatitude(), rotation, scale);
                ProjCoordinate toGeo = CoordinateConverter.toAbsoluteLocal(
                        od.toX(), od.toY(), scenario.getLongitude(), scenario.getLatitude(), rotation, scale);

                double fgx = Math.floor(fromGeo.x / OD_FLOW_GRID_DEG);
                double fgy = Math.floor(fromGeo.y / OD_FLOW_GRID_DEG);
                double tgx = Math.floor(toGeo.x / OD_FLOW_GRID_DEG);
                double tgy = Math.floor(toGeo.y / OD_FLOW_GRID_DEG);
                if (fgx == tgx && fgy == tgy) continue; // 같은 격자 내 이동 — 화살표 의미 없음

                String key = fgx + "_" + fgy + "_" + tgx + "_" + tgy;
                counts.merge(key, 1, Integer::sum);
                coordsByKey.computeIfAbsent(key, k -> new double[]{
                        (fgx + 0.5) * OD_FLOW_GRID_DEG, (fgy + 0.5) * OD_FLOW_GRID_DEG,
                        (tgx + 0.5) * OD_FLOW_GRID_DEG, (tgy + 0.5) * OD_FLOW_GRID_DEG,
                });
            }

            List<OdFlowResponse.OdPair> pairs = counts.entrySet().stream()
                    .sorted((a, b) -> b.getValue() - a.getValue())
                    .limit(maxPairs)
                    .map(e -> {
                        double[] c = coordsByKey.get(e.getKey());
                        return new OdFlowResponse.OdPair(c[0], c[1], c[2], c[3], e.getValue());
                    })
                    .collect(Collectors.toList());

            OdFlowResponse result = new OdFlowResponse();
            result.setFromTime(fromTime);
            result.setToTime(toTime);
            result.setPairs(pairs);
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] od-flow 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 시뮬레이션 전체 요약 통계 API
     *
     * @param versionId 시나리오 버전 ID
     */
    @GetMapping("/summary/{versionId}")
    public ResponseEntity<OverallSummaryResponse> getSummary(@PathVariable String versionId) {
        OverallSummaryResponse summary = vehicleDataReader.readOverallSummary(versionId);
        return ResponseEntity.ok(summary);
    }

    /** region-traffic 실시간 스냅샷 ± 반폭(초) — countActiveVehicles와 동일 관례 */
    private static final double REGION_TRAFFIC_HALF_WINDOW_SEC = 5.0;

    /**
     * 행정구역(시도/시군구/읍면동) 단위 교통량 집계 — 줌 레벨에 따라 프론트가 tier를 바꿔가며
     * 요청한다. 범위는 항상 시나리오 네트워크 extent 전체("시나리오 범위만" 요구사항) — bbox
     * 파라미터 없음. 경계는 VWorld Data API에서 가져와 캐시되므로(AdminBoundaryService) 반복
     * 호출 비용이 낮다.
     *
     * <p>volume은 **실시간 스냅샷**이다(atTime ± 5초 안에서 각 차량의 그 순간 위치) — 시간창을
     * 누적하거나("전체 140대인데 동마다 1000대") 체류시간으로 다수결 배정하는 방식은 전부
     * "지금 이 순간의 위치"를 반영하지 못한다는 지적을 받아 countActiveVehicles와 동일한
     * atTime/halfWindowSec 스냅샷 방식으로 바꿨다 — 재생이 진행되면 프론트가 atTime을 계속
     * 갱신해 재요청해야 실시간으로 보인다(정적 캐시 불가, 경계 지오메트리만 캐시 대상).
     *
     * @param tier   "sido" | "sigungu" | "eupmyeondong"
     * @param atTime 스냅샷 시각(시뮬레이션 시작 기준 초). 미지정 시 0(시뮬 시작 시점).
     */
    @GetMapping("/region-traffic/{versionId}")
    public ResponseEntity<RegionTrafficResponse> getRegionTraffic(
            @PathVariable String versionId,
            @RequestParam String tier,
            @RequestParam(defaultValue = "0") double atTime) {
        try {
            double[] extent = networkTileService.getExtent(versionId);
            if (extent == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();

            List<RegionBoundary> boundaries = adminBoundaryService.getBoundaries(versionId, tier, extent);

            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, extent[0], extent[1], extent[2], extent[3], NetworkTileService.Lod.NEAR);
            List<String> linkIds = new ArrayList<>();
            Map<String, LinkResponse> linkById = new HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) {
                    String id = String.valueOf(l.getId());
                    linkIds.add(id);
                    linkById.put(id, l);
                }
            }

            // 링크 중심점(좌표 평균)으로 소속 지역 배정 → 지역별 capacity/centroid/linkCount 집계.
            // capacity(qmax)는 시간창과 무관한 링크 정적 속성이라 fromTime/toTime=0,0으로 좌표만
            // 얻으면 충분 — volume은 아래에서 atTime 스냅샷으로 별도 계산한다.
            //
            // centroid는 지역 경계 전체(예: 경기도)가 아니라 "이 시나리오 안에서 실제로 배정된
            // 링크들"의 평균 위치로 계산한다 — 시도/시군구처럼 행정경계가 시나리오 extent보다
            // 훨씬 넓으면 진짜 폴리곤 중심(예: 경기도 중심 = 화면 밖 남쪽)에 라벨/3D 컬럼이
            // 찍혀 시나리오 영역 밖으로 나가버리는 문제를 실측으로 확인해 이렇게 수정함.
            LinkTrafficResponse traffic = vehicleDataReader.readLinkTraffic(versionId, linkIds, 0, 0);
            applyLinkMetrics(traffic, linkById);

            Map<String, RegionTrafficResponse.RegionTraffic> byCode = new HashMap<>();
            Map<String, double[]> centroidAccum = new HashMap<>(); // code -> {sumLng, sumLat, n}
            Map<String, String> linkToRegionCode = new HashMap<>();
            for (LinkTrafficResponse.LinkTraffic lt : traffic.getLinks()) {
                if (lt.getCoordinates() == null || lt.getCoordinates().isEmpty()) continue;
                double sumLng = 0, sumLat = 0;
                int n = 0;
                for (var c : lt.getCoordinates()) {
                    if (c.getLng() == null || c.getLat() == null) continue;
                    sumLng += c.getLng(); sumLat += c.getLat(); n++;
                }
                if (n == 0) continue;
                double lng = sumLng / n, lat = sumLat / n;

                RegionBoundary region = PolygonBoundaryUtils.findContainingRegion(lng, lat, boundaries, RegionBoundary::getRings);
                if (region == null) continue;
                linkToRegionCode.put(lt.getLinkId(), region.getCode());

                RegionTrafficResponse.RegionTraffic rt = byCode.computeIfAbsent(region.getCode(), k ->
                        new RegionTrafficResponse.RegionTraffic(region.getCode(), region.getName(), region.getRings(),
                                null, 0, 0.0, -1, 0));
                rt.setCapacity(rt.getCapacity() + lt.getCapacity());
                rt.setLinkCount(rt.getLinkCount() + 1);

                double[] acc = centroidAccum.computeIfAbsent(region.getCode(), k -> new double[3]);
                acc[0] += lng; acc[1] += lat; acc[2] += 1;
            }

            // 지역별 "지금 이 순간" 차량 수 — 차량마다 atTime에 가장 가까운 위치(링크) 1개만 받아
            // 지역 1곳에만 배정한다("동별 합계 = 전체 차량 수"가 되는 분할이자 실시간 스냅샷).
            Map<String, Set<String>> vehiclesByRegion = new HashMap<>();
            for (var pair : vehicleDataReader.readVehicleCurrentLink(
                    versionId, linkIds, atTime, REGION_TRAFFIC_HALF_WINDOW_SEC)) {
                String code = linkToRegionCode.get(pair.linkId());
                if (code == null) continue;
                vehiclesByRegion.computeIfAbsent(code, k -> new HashSet<>()).add(pair.vehId());
            }

            int windowSeconds = (int) (REGION_TRAFFIC_HALF_WINDOW_SEC * 2);
            for (RegionTrafficResponse.RegionTraffic rt : byCode.values()) {
                int volume = vehiclesByRegion.getOrDefault(rt.getCode(), Set.of()).size();
                rt.setVolume(volume);
                rt.setVcRatio(TrafficMetricsUtil.vcRatio(volume, windowSeconds, rt.getCapacity()));
                double[] acc = centroidAccum.get(rt.getCode());
                rt.setCentroid(acc != null && acc[2] > 0
                        ? new double[]{acc[0] / acc[2], acc[1] / acc[2]}
                        : computeCentroid(rt.getRings()));
            }

            RegionTrafficResponse out = new RegionTrafficResponse();
            out.setTier(tier);
            out.getRegions().addAll(byCode.values());
            return ResponseEntity.ok(out);
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] region-traffic 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 지역 경계(여러 링의 첫 번째, 보통 가장 큰 외곽 폴리곤)의 정점 평균을 중심점으로 근사 */
    private double[] computeCentroid(List<List<double[]>> rings) {
        if (rings == null || rings.isEmpty()) return new double[]{0, 0};
        List<double[]> ring = rings.get(0);
        double sumLng = 0, sumLat = 0;
        for (double[] pt : ring) { sumLng += pt[0]; sumLat += pt[1]; }
        return new double[]{sumLng / ring.size(), sumLat / ring.size()};
    }

    /**
     * 지역(시도/시군구/읍면동) 간 OD 관계 그래프 — "지식그래프" 스타일 노드(지역)+엣지(통행) 시각화.
     * 범위는 항상 시나리오 네트워크 extent 전체("시나리오 범위만"). 각 차량은 시간창 내 출발
     * 지역·도착 지역 각 1곳에만 기여하므로(readVehicleFirstLastPositions가 차량당 첫/끝 위치
     * 하나씩만 주므로) region-traffic의 volume 이중카운트 문제가 여기선 발생하지 않는다.
     *
     * @param tier     "sido" | "sigungu" | "eupmyeondong"
     * @param fromTime 시간창 시작(초), toTime 끝(초). 미지정(0,0) 시 전체 시간.
     */
    @GetMapping("/region-od-graph/{versionId}")
    public ResponseEntity<RegionOdGraphResponse> getRegionOdGraph(
            @PathVariable String versionId,
            @RequestParam String tier,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime) {
        try {
            double[] extent = networkTileService.getExtent(versionId);
            if (extent == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();

            Scenario scenario = scenarioService.getScenarioByKey(versionId);
            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }
            double rotation = scenario.getBaseRotation() != null ? scenario.getBaseRotation() : 0.0;
            double scale = scenario.getBaseScale() != null ? scenario.getBaseScale() : 1.0;

            List<RegionBoundary> boundaries = adminBoundaryService.getBoundaries(versionId, tier, extent);

            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, extent[0], extent[1], extent[2], extent[3], NetworkTileService.Lod.MID);
            List<String> linkIds = new ArrayList<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) linkIds.add(String.valueOf(l.getId()));
            }

            List<VehicleDataReader.VehicleOd> vehOds = vehicleDataReader.readVehicleFirstLastPositions(
                    versionId, linkIds, fromTime, toTime, OD_FLOW_MAX_VEHICLES);

            Map<String, Integer> edgeCounts = new HashMap<>();
            Map<String, Integer> nodeVolume = new HashMap<>();
            Map<String, double[]> centroidAccum = new HashMap<>(); // code -> {sumLng, sumLat, n}
            Map<String, String> nameByCode = new HashMap<>();

            for (VehicleDataReader.VehicleOd od : vehOds) {
                ProjCoordinate fromGeo = CoordinateConverter.toAbsoluteLocal(
                        od.fromX(), od.fromY(), scenario.getLongitude(), scenario.getLatitude(), rotation, scale);
                ProjCoordinate toGeo = CoordinateConverter.toAbsoluteLocal(
                        od.toX(), od.toY(), scenario.getLongitude(), scenario.getLatitude(), rotation, scale);

                RegionBoundary fromRegion = PolygonBoundaryUtils.findContainingRegion(
                        fromGeo.x, fromGeo.y, boundaries, RegionBoundary::getRings);
                RegionBoundary toRegion = PolygonBoundaryUtils.findContainingRegion(
                        toGeo.x, toGeo.y, boundaries, RegionBoundary::getRings);
                if (fromRegion == null || toRegion == null) continue;
                if (fromRegion.getCode().equals(toRegion.getCode())) continue; // 같은 지역 내 이동 — 엣지 의미 없음

                nameByCode.put(fromRegion.getCode(), fromRegion.getName());
                nameByCode.put(toRegion.getCode(), toRegion.getName());

                edgeCounts.merge(fromRegion.getCode() + "_" + toRegion.getCode(), 1, Integer::sum);
                nodeVolume.merge(fromRegion.getCode(), 1, Integer::sum);
                nodeVolume.merge(toRegion.getCode(), 1, Integer::sum);

                double[] fromAcc = centroidAccum.computeIfAbsent(fromRegion.getCode(), k -> new double[3]);
                fromAcc[0] += fromGeo.x; fromAcc[1] += fromGeo.y; fromAcc[2] += 1;
                double[] toAcc = centroidAccum.computeIfAbsent(toRegion.getCode(), k -> new double[3]);
                toAcc[0] += toGeo.x; toAcc[1] += toGeo.y; toAcc[2] += 1;
            }

            RegionOdGraphResponse out = new RegionOdGraphResponse();
            out.setTier(tier);
            for (String code : nodeVolume.keySet()) {
                double[] acc = centroidAccum.get(code);
                double[] centroid = acc != null && acc[2] > 0
                        ? new double[]{acc[0] / acc[2], acc[1] / acc[2]} : new double[]{0, 0};
                out.getNodes().add(new RegionOdGraphResponse.Node(
                        code, nameByCode.get(code), centroid, nodeVolume.get(code)));
            }
            for (var e : edgeCounts.entrySet()) {
                String[] parts = e.getKey().split("_", 2);
                out.getEdges().add(new RegionOdGraphResponse.Edge(parts[0], parts[1], e.getValue()));
            }
            return ResponseEntity.ok(out);
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] region-od-graph 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 혼잡 전파 그래프 기본 V/C 임계값 — 이 이상만 "정체 노드"로 포함 */
    private static final double CONGESTION_GRAPH_THRESHOLD = 0.7;

    /**
     * 혼잡 전파(인접 정체 링크 연결) 그래프 — "지식그래프" 스타일. V/C가 threshold 이상인 링크를
     * 노드로, 네트워크 커넥션(회전)으로 직접 이어진 두 정체 링크를 엣지로 연결한다.
     *
     * ⚠️ 실제 HCM 충격파 해석이 아니라 인접 정체 구간을 보여주는 근사(CongestionGraphResponse 참고).
     *
     * @param bbox      "west,south,east,north" (WGS84)
     * @param fromTime  시간창 시작(초), toTime 끝(초). 미지정(0,0) 시 전체 시간.
     * @param threshold 정체 판정 V/C 임계값 (기본 0.7)
     */
    @GetMapping("/congestion-graph/{versionId}")
    public ResponseEntity<CongestionGraphResponse> getCongestionGraph(
            @PathVariable String versionId,
            @RequestParam String bbox,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime,
            @RequestParam(defaultValue = "0.7") double threshold) {
        try {
            double[] b = parseBbox(bbox);
            if (b == null) return ResponseEntity.badRequest().build();

            // NEAR 이상이어야 connections(회전 정보)가 채워진다(NetworkTileService: includeNodes =
            // lod==NEAR||DETAIL) — congestion/los 레이어의 MID 조회와 달리 여기선 노드가 필요하다.
            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, b[0], b[1], b[2], b[3], NetworkTileService.Lod.NEAR);
            List<String> linkIds = new ArrayList<>();
            Map<String, LinkResponse> linkById = new HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) {
                    String id = String.valueOf(l.getId());
                    linkIds.add(id);
                    linkById.put(id, l);
                }
            }

            LinkTrafficResponse traffic = vehicleDataReader.readLinkTraffic(versionId, linkIds, fromTime, toTime);
            applyLinkMetrics(traffic, linkById);

            Map<String, LinkTrafficResponse.LinkTraffic> congested = new HashMap<>();
            for (LinkTrafficResponse.LinkTraffic lt : traffic.getLinks()) {
                if (lt.getVcRatio() >= threshold) congested.put(lt.getLinkId(), lt);
            }

            CongestionGraphResponse out = new CongestionGraphResponse();
            for (var entry : congested.entrySet()) {
                LinkTrafficResponse.LinkTraffic lt = entry.getValue();
                double[] centroid = {0, 0};
                if (lt.getCoordinates() != null && !lt.getCoordinates().isEmpty()) {
                    double sumLng = 0, sumLat = 0;
                    int n = 0;
                    for (var c : lt.getCoordinates()) {
                        if (c.getLng() == null || c.getLat() == null) continue;
                        sumLng += c.getLng(); sumLat += c.getLat(); n++;
                    }
                    if (n > 0) centroid = new double[]{sumLng / n, sumLat / n};
                }
                out.getNodes().add(new CongestionGraphResponse.Node(
                        entry.getKey(), centroid, lt.getVcRatio(), lt.getLosGrade()));
            }

            Set<String> addedEdges = new HashSet<>();
            for (NodeResponse node : net.getNodes()) {
                for (var conn : node.getConnections()) {
                    if (conn.getFromLink() == null || conn.getToLink() == null) continue;
                    String from = String.valueOf(conn.getFromLink());
                    String to = String.valueOf(conn.getToLink());
                    if (!congested.containsKey(from) || !congested.containsKey(to)) continue;
                    String key = from + "_" + to;
                    if (!addedEdges.add(key)) continue;
                    out.getEdges().add(new CongestionGraphResponse.Edge(from, to));
                }
            }
            return ResponseEntity.ok(out);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] congestion-graph 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 등시선/커버리지 원점 스냅 반경(m) — 이보다 먼 노드가 가장 가까워도 "근처에 도로 없음"으로 취급 */
    private static final double ISOCHRONE_SNAP_RADIUS_M = 300;

    /** (lng,lat)에서 가장 가까운 네트워크 노드 id (평면거리 근사, 스냅 반경 밖이면 null) */
    private Long findNearestNode(NetworkResponse net, double lng, double lat) {
        double metersPerDegLat = 111000.0;
        double metersPerDegLng = 111000.0 * Math.cos(Math.toRadians(lat));
        Long nearestNodeId = null;
        double nearestDist = Double.MAX_VALUE;
        for (NodeResponse node : net.getNodes()) {
            if (node.getId() == null || node.getCoordinates() == null) continue;
            Double nLng = node.getCoordinates().getLng();
            Double nLat = node.getCoordinates().getLat();
            if (nLng == null || nLat == null) continue;
            double dx = (nLng - lng) * metersPerDegLng;
            double dy = (nLat - lat) * metersPerDegLat;
            double d = Math.sqrt(dx * dx + dy * dy);
            if (d < nearestDist) { nearestDist = d; nearestNodeId = node.getId(); }
        }
        return (nearestNodeId != null && nearestDist <= ISOCHRONE_SNAP_RADIUS_M) ? nearestNodeId : null;
    }

    /**
     * 시설(버스정류장/철도역) 서비스권 커버리지("영향권") 분석 — 뷰포트가 아니라 시나리오 범위
     * 전체의 대상 시설 각각에서 maxMinutes 안에 도달 가능한 링크를 계산해, 링크별로 "몇 개
     * 시설에서 도달 가능한가(coverageCount)"를 누적한다. 클릭 등 사용자 입력 없이 체크박스만
     * 켜면 자동 계산된다.
     *
     * ⚠️ 실제 교통배정/HCM 모델이 아니라 자유흐름속도+V/C 근사 감속(IsochroneService, BPR류 함수)
     * 기반 추정이다.
     *
     * @param facilityTypes  쉼표 구분 "bus,rail" (기본 둘 다)
     * @param maxMinutes     탐색 상한 (기본 10분)
     * @param fromTime/toTime V/C 계산용 시간창(초). 미지정(0,0) 시 전체 시간.
     */
    @GetMapping("/facility-coverage/{versionId}")
    public ResponseEntity<FacilityCoverageResponse> getFacilityCoverage(
            @PathVariable String versionId,
            @RequestParam(defaultValue = "bus,rail") String facilityTypes,
            @RequestParam(defaultValue = "10") double maxMinutes,
            @RequestParam(defaultValue = "0") int fromTime,
            @RequestParam(defaultValue = "0") int toTime) {
        try {
            double[] extent = networkTileService.getExtent(versionId);
            if (extent == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();

            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, extent[0], extent[1], extent[2], extent[3], NetworkTileService.Lod.NEAR);

            Scenario scenario = scenarioService.getScenarioByKey(versionId);
            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }
            double rotation = Math.toRadians(scenario.getBaseRotation() != null ? scenario.getBaseRotation() : 0.0);
            double scale = scenario.getBaseScale() != null ? scenario.getBaseScale() : 1.0;

            Set<String> types = Set.of(facilityTypes.split(","));
            FacilityCoverageResponse out = new FacilityCoverageResponse();
            out.setMaxMinutes(maxMinutes);
            List<Long> originNodeIds = new ArrayList<>();

            // center(로컬 좌표 문자열)를 시나리오 캘리브레이션으로 WGS84 변환 — RailStationService의
            // 기존 변환 로직(CoordinateUtils.parseAndTransform)과 동일 방식.
            //
            // ⚠️ 정류장 파일 자체가 없는 시나리오는 BusStationController/RailStationController가
            // 그렇듯 IOException(때로는 RuntimeException으로 감싸져) 을 던진다(실측: scenario2_2
            // 에서 500 발생). "그 시설 타입이 이 시나리오에 없음"은 정상 상황(사각지대 0건으로
            // 취급해야지 요청 전체를 실패시키면 안 됨) — 타입별로 개별 try/catch.
            if (types.contains("bus")) {
                try {
                    for (var s : busStationService.getBusStationsByVersionId(versionId).getBusStations()) {
                        if (s.getCenter() == null) continue;
                        var coords = com.iitp.iitp_rest.util.CoordinateUtils.parseAndTransform(
                                s.getCenter(), scenario.getLongitude(), scenario.getLatitude(), rotation, scale);
                        if (coords.isEmpty()) continue;
                        var c = coords.get(0);
                        if (c.getLng() == null || c.getLat() == null) continue;
                        Long nodeId = findNearestNode(net, c.getLng(), c.getLat());
                        if (nodeId == null) continue;
                        originNodeIds.add(nodeId);
                        out.getFacilities().add(new FacilityCoverageResponse.Facility("bus", c.getLng(), c.getLat()));
                    }
                } catch (Exception e) {
                    log.info("[AnalyticsController] {} 버스정류장 없음/조회 실패 — 0건으로 처리: {}", versionId, e.getMessage());
                }
            }
            if (types.contains("rail")) {
                try {
                    var railXml = railStationService.getRailStationXmlByVersionId(versionId);
                    for (var s : railXml.getRailStations()) {
                        if (s.getCenter() == null) continue;
                        var coords = com.iitp.iitp_rest.util.CoordinateUtils.parseAndTransform(
                                s.getCenter(), scenario.getLongitude(), scenario.getLatitude(), rotation, scale);
                        if (coords.isEmpty()) continue;
                        var c = coords.get(0);
                        if (c.getLng() == null || c.getLat() == null) continue;
                        Long nodeId = findNearestNode(net, c.getLng(), c.getLat());
                        if (nodeId == null) continue;
                        originNodeIds.add(nodeId);
                        out.getFacilities().add(new FacilityCoverageResponse.Facility("rail", c.getLng(), c.getLat()));
                    }
                } catch (Exception e) {
                    log.info("[AnalyticsController] {} 철도역 없음/조회 실패 — 0건으로 처리: {}", versionId, e.getMessage());
                }
            }
            out.setFacilityCount(originNodeIds.size());
            if (originNodeIds.isEmpty()) return ResponseEntity.ok(out);

            List<String> linkIds = new ArrayList<>();
            Map<String, LinkResponse> linkById = new HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) {
                    String id = String.valueOf(l.getId());
                    linkIds.add(id);
                    linkById.put(id, l);
                }
            }
            LinkTrafficResponse traffic = vehicleDataReader.readLinkTraffic(versionId, linkIds, fromTime, toTime);
            applyLinkMetrics(traffic, linkById);
            Map<String, Double> vcByLinkId = new HashMap<>();
            for (LinkTrafficResponse.LinkTraffic lt : traffic.getLinks()) {
                vcByLinkId.put(lt.getLinkId(), lt.getVcRatio());
            }

            Map<String, Integer> coverage = isochroneService.computeCoverage(net, originNodeIds, maxMinutes, vcByLinkId);
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() == null) continue;
                Integer count = coverage.get(String.valueOf(l.getId()));
                if (count == null) continue;
                out.getLinks().add(new FacilityCoverageResponse.CoveredLink(
                        String.valueOf(l.getId()), l.getCoordinates(), count));
            }
            return ResponseEntity.ok(out);
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[AnalyticsController] facility-coverage 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
