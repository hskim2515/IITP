package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
import com.iitp.iitp_rest.model.analytics.LinkTrafficResponse;
import com.iitp.iitp_rest.model.analytics.OverallSummaryResponse;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;

@Slf4j
@RestController
@RequestMapping("/analytics")
@AllArgsConstructor
public class AnalyticsController {

    private final VehicleDataReader vehicleDataReader;
    private final NetworkTileService networkTileService;

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
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() != null) linkIds.add(String.valueOf(l.getId()));
            }

            // 2) 차량 SQLite 에서 그 링크들의 집계
            LinkTrafficResponse result = vehicleDataReader.readLinkTraffic(versionId, linkIds, fromTime, toTime);
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
