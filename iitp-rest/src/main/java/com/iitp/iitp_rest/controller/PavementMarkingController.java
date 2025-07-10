package com.iitp.iitp_rest.controller;
import com.iitp.iitp_rest.model.pavementMarking.*;
import com.iitp.iitp_rest.service.pavementMarking.PavementMarkingService;
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

    public PavementMarkingController(PavementMarkingService pavementMarkingService) {
        this.pavementMarkingService = pavementMarkingService;
    }

    @GetMapping("/{versionId}")
    public ResponseEntity<RoadAssetData> getPavementMarkingByVersion(@PathVariable String versionId) {
        logger.info("[getPavementMarkingByVersion] versionId: {}", versionId);
        RoadAssetData result = new RoadAssetData();
        PavementMarkingVersion pavementMarking = pavementMarkingService.getPavementMarking(versionId);
        logger.info("[getPavementMarkingByVersion] pavementMarking.getData(): {}", pavementMarking.getData());
        result.setPavementMarkings(pavementMarking.getData());
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
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

}