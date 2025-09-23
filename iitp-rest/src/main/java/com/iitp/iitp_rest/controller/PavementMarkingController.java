package com.iitp.iitp_rest.controller;
import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.pavementMarking.*;
import com.iitp.iitp_rest.model.signal.SignalNodeResponseData;
import com.iitp.iitp_rest.model.signal.SignalResponse;
import com.iitp.iitp_rest.model.signal.SignalVersion;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
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
    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository;

    public PavementMarkingController(PavementMarkingService pavementMarkingService, PavementMarkingVersionsRepository pavementMarkingVersionsRepository) {
        this.pavementMarkingService = pavementMarkingService;
        this.pavementMarkingVersionsRepository = pavementMarkingVersionsRepository;
    }

    @GetMapping("/{versionId}")
    public ResponseEntity<RoadAssetData> getPavementMarking(@PathVariable String versionId) {
        try {
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

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
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