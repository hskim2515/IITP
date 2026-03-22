package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.AllArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/analytics")
@AllArgsConstructor
public class AnalyticsController {

    private final VehicleDataReader vehicleDataReader;

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
}
