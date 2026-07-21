package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
import com.iitp.iitp_rest.model.analytics.LinkTrafficResponse;
import com.iitp.iitp_rest.model.analytics.OdFlowResponse;
import com.iitp.iitp_rest.model.analytics.OverallSummaryResponse;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/analytics")
@AllArgsConstructor
public class AnalyticsController {

    private final VehicleDataReader vehicleDataReader;
    private final NetworkTileService networkTileService;
    private final ScenarioService scenarioService;

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
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            // 1) bbox 내 링크 id 목록 (네트워크 RTree 재사용 — overview lod 로 간선 위주)
            NetworkResponse net = networkTileService.queryByBbox(
                    versionId, west, south, east, north, NetworkTileService.Lod.MID);
            List<String> linkIds = new ArrayList<>();
            java.util.Map<String, LinkResponse> linkById = new java.util.HashMap<>();
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) {
                    String id = String.valueOf(l.getId());
                    linkIds.add(id);
                    linkById.put(id, l);
                }
            }

            // 2) 차량 SQLite 에서 그 링크들의 집계
            LinkTrafficResponse result = vehicleDataReader.readLinkTraffic(versionId, linkIds, fromTime, toTime);

            // 3) 링크 좌표 동봉 — 네트워크 타일 모드에서 클라이언트가 전체 링크 지오메트리를
            //    보유하지 않으므로, 히트맵 렌더에 필요한 중심선 좌표를 집계 응답에 함께 내린다.
            for (LinkTrafficResponse.LinkTraffic lt : result.getLinks()) {
                LinkResponse link = linkById.get(lt.getLinkId());
                if (link != null) lt.setCoordinates(link.getCoordinates());
            }
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
}
