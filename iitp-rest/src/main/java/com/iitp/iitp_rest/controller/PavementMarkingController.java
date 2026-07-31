package com.iitp.iitp_rest.controller;
import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.pavementMarking.*;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
import com.iitp.iitp_rest.service.pavementMarking.PavementMarkingService;
import com.iitp.iitp_rest.service.pavementMarking.PavementMarkingTileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/pavement-marking")
public class PavementMarkingController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final PavementMarkingService pavementMarkingService;
    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository;
    private final PavementMarkingTileService pavementMarkingTileService;

    public PavementMarkingController(PavementMarkingService pavementMarkingService, PavementMarkingVersionsRepository pavementMarkingVersionsRepository, PavementMarkingTileService pavementMarkingTileService) {
        this.pavementMarkingService = pavementMarkingService;
        this.pavementMarkingVersionsRepository = pavementMarkingVersionsRepository;
        this.pavementMarkingTileService = pavementMarkingTileService;
    }

    /**
     * 노면표시 BBox 타일링 조회 (읽기 전용) — viewport 와 교차하는 노면표시만 반환.
     * 기존 {@code GET /{versionId}} 와 병존.
     */
    @GetMapping("/{versionId}/tiles")
    public ResponseEntity<RoadAssetData> getPavementMarkingTiles(
            @PathVariable String versionId,
            @RequestParam String bbox) {
        try {
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            List<PavementMarkingData> markings = pavementMarkingTileService.queryByBbox(versionId, west, south, east, north);
            RoadAssetData result = new RoadAssetData();
            result.setPavementMarkings(markings);
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            logger.error("[getPavementMarkingTiles] 타일 조회 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/{versionId}")
    public ResponseEntity<RoadAssetData> getPavementMarking(@PathVariable String versionId) throws Exception {
        RoadAssetData result = new RoadAssetData();

        Optional<PavementMarkingVersion> pavementMarkingVersionOpt = pavementMarkingVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST);
        List<PavementMarkingData> pavementMarkingData;

        if (pavementMarkingVersionOpt.isPresent()) {
            PavementMarkingVersion pavementMarkingVersion = pavementMarkingService.getDataFromDatabase(versionId);
            result.setPavementMarkings(pavementMarkingVersion.getData());
        } else {
            pavementMarkingData = pavementMarkingService.getDataFromXml(versionId);
            result.setPavementMarkings(pavementMarkingData);
        }
        return ResponseEntity.ok(result);
    }
    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<PavementMarkingLogs>> getLogsByVersion(@PathVariable String versionId) {
        logger.info("[getLogsByVersion] versionId: {}", versionId);
        try {
            List<PavementMarkingLogs> logs = pavementMarkingService.getLogsByVersion(versionId);
            logger.info("[getLogsByVersion] getLogsByVersion: {}", logs);
            return ResponseEntity.ok(logs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> savePavementMarking (@RequestBody PavementMarkingSaveRequest request, @PathVariable String versionId) {
        logger.info("[savePavementMarking] request: {}", request);
        try {
            pavementMarkingService.savePavementMarking(request, versionId);
            // 타일 캐시 무효화 + 즉시 재빌드 — signal/busStation/railStation과 동일 패턴.
            // PavementMarkingSaveRequest.getData()가 곧 List<PavementMarkingData>이므로 재조회 없이 바로 사용.
            try {
                pavementMarkingTileService.invalidate(versionId);
                pavementMarkingTileService.ingest(versionId, request.getData() != null ? request.getData() : List.of());
            } catch (Exception e) {
                logger.warn("[savePavementMarking] 노면표시 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<RoadAssetData> getOriginPavementMarking(@PathVariable String versionId) {
        try {
            RoadAssetData result = new RoadAssetData();
            Optional<PavementMarkingVersion> pavementMarkingVersionOpt = pavementMarkingVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN);

            if (pavementMarkingVersionOpt.isPresent()) {
                PavementMarkingVersion pavementMarkingVersion = pavementMarkingService.getOriginData(versionId);
                result.setPavementMarkings(pavementMarkingVersion.getData());
            }

            return ResponseEntity.ok(result);
        }  catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

}