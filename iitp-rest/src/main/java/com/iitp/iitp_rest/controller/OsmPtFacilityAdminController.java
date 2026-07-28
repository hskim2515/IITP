package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.service.network.OsmPtFacilityImporter;
import com.iitp.iitp_rest.service.network.OsmTrafficSignalImporter;
import com.iitp.iitp_rest.service.network.OsmTurnRestrictionImporter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * osmium으로 필터링한 OSM XML을 로컬 테이블(osm_pt_*, osm_turn_restriction, osm_traffic_signal)에
 * 적재하는 관리용 트리거. 운영 중 상시 호출되는 엔드포인트가 아니라, 한국 OSM 데이터를 처음
 * 구축하거나 주기적으로 갱신할 때 한 번씩 수동으로 호출하는 용도(각 임포터 클래스 주석의
 * osmium 사전 준비 명령 참고).
 */
@Slf4j
@RestController
@RequestMapping("/admin/osm-pt")
@RequiredArgsConstructor
public class OsmPtFacilityAdminController {

    private final OsmPtFacilityImporter importer;
    private final OsmTurnRestrictionImporter turnRestrictionImporter;
    private final OsmTrafficSignalImporter trafficSignalImporter;

    @PostMapping("/import")
    public ResponseEntity<?> importFromFile(@RequestParam String path) {
        Path file = Path.of(path);
        if (!Files.exists(file)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "파일이 없습니다: " + path));
        }
        try {
            OsmPtFacilityImporter.ImportResult result = importer.importFromXml(file);
            return ResponseEntity.ok(Map.of(
                    "nodeCount", result.nodeCount(),
                    "wayCount", result.wayCount(),
                    "relationCount", result.relationCount(),
                    "elapsedMs", result.elapsedMs()
            ));
        } catch (Exception e) {
            log.error("[OsmPtFacilityAdminController] 임포트 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/import-turn-restrictions")
    public ResponseEntity<?> importTurnRestrictions(@RequestParam String path) {
        Path file = Path.of(path);
        if (!Files.exists(file)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "파일이 없습니다: " + path));
        }
        try {
            OsmTurnRestrictionImporter.ImportResult result = turnRestrictionImporter.importFromXml(file);
            return ResponseEntity.ok(Map.of(
                    "totalRelations", result.totalRelations(),
                    "resolvedCount", result.resolvedCount(),
                    "elapsedMs", result.elapsedMs()
            ));
        } catch (Exception e) {
            log.error("[OsmPtFacilityAdminController] 회전제약 임포트 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/import-traffic-signals")
    public ResponseEntity<?> importTrafficSignals(@RequestParam String path) {
        Path file = Path.of(path);
        if (!Files.exists(file)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "파일이 없습니다: " + path));
        }
        try {
            OsmTrafficSignalImporter.ImportResult result = trafficSignalImporter.importFromXml(file);
            return ResponseEntity.ok(Map.of(
                    "signalCount", result.signalCount(),
                    "elapsedMs", result.elapsedMs()
            ));
        } catch (Exception e) {
            log.error("[OsmPtFacilityAdminController] 신호등 임포트 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", e.getMessage()));
        }
    }
}
