package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.signal.*;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import com.iitp.iitp_rest.service.signal.SignalService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/signal")
public class SignalController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final SignalService signalService;
    private final SignalVersionsRepository signalVersionsRepository;

    public SignalController(SignalService signalService, SignalVersionsRepository signalVersionsRepository) {
        this.signalService = signalService;
        this.signalVersionsRepository = signalVersionsRepository;
    }

@GetMapping("/{versionId}")
public ResponseEntity<SignalNodeResponseData> getSignal(@PathVariable String versionId) {
    try {
        SignalNodeResponseData result = new SignalNodeResponseData();

        Optional<SignalVersion> signalVersionOpt = signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST);
        List<SignalResponse> signalResponseList;

        if (signalVersionOpt.isPresent()) {
            SignalVersion signalVersion = signalService.getDataFromDatabase(versionId);
            result.setSignals(signalVersion.getData());
        } else {
            signalResponseList = signalService.getDataFromXml(versionId);
            result.setSignals(signalResponseList);
        }
        return ResponseEntity.ok(result);

    } catch (java.io.FileNotFoundException e) {
        logger.warn("[getSignal] 원격 데이터 없음: {}", versionId);
        return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
    } catch (Exception e) {
        e.printStackTrace();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
    }
}

    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<SignalLogs>> getLogsByVersion(@PathVariable String versionId) {
        logger.info("[getLogsByVersion] versionId: {}", versionId);
        try {
            List<SignalLogs> logs = signalService.getLogsByVersion(versionId);
            logger.info("[getLogsByVersion] getLogsByVersion: {}", logs);
            return ResponseEntity.ok(logs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveSignal (@RequestBody SignalSaveRequest request, @PathVariable String versionId) {
        logger.info("[saveSignal] request: {}", request);
        try {
            signalService.saveSignal(request, versionId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<SignalNodeResponseData> getOriginSignal(@PathVariable String versionId) {
        try {
            SignalNodeResponseData result = new SignalNodeResponseData();
            Optional<SignalVersion> signalVersionOpt = signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN);

            if (signalVersionOpt.isPresent()) {
                SignalVersion signalVersion = signalService.getOriginData(versionId);
                result.setSignals(signalVersion.getData());
            }

            return ResponseEntity.ok(result);
        }  catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}