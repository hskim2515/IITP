package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.signal.*;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import com.iitp.iitp_rest.service.signal.SignalJaxbParser;
import com.iitp.iitp_rest.service.signal.SignalService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/signal")
public class SignalController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final SignalService signalService;
    private final SignalVersionsRepository signalVersionsRepository;
    private final SignalJaxbParser signalJaxbParser;

    public SignalController(SignalService signalService, SignalVersionsRepository signalVersionsRepository,
                            SignalJaxbParser signalJaxbParser) {
        this.signalService = signalService;
        this.signalVersionsRepository = signalVersionsRepository;
        this.signalJaxbParser = signalJaxbParser;
    }

@GetMapping("/{versionId}")
public ResponseEntity<SignalNodeResponseData> getSignal(@PathVariable String versionId) {
    try {
        SignalNodeResponseData result = new SignalNodeResponseData();

        Optional<SignalVersion> signalVersionOpt = signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST);
        List<SignalResponse> signalResponseList;

        boolean hasDbData = signalVersionOpt.isPresent()
                && signalVersionOpt.get().getData() != null
                && !signalVersionOpt.get().getData().isEmpty();

        if (hasDbData) {
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

    @GetMapping("/{versionId}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String versionId) {
        try {
            List<SignalResponse> signals;
            Optional<SignalVersion> opt = signalVersionsRepository.findByVersionIdAndVersionRole(
                    versionId, BaseVersion.VersionRole.LATEST);
            boolean hasDbData = opt.isPresent() && opt.get().getData() != null && !opt.get().getData().isEmpty();
            if (hasDbData) {
                signals = opt.get().getData();
            } else {
                signals = signalService.getDataFromXml(versionId);
            }
            SignalXml xml = signalService.toSignalXml(signals);
            byte[] bytes = signalJaxbParser.marshal(xml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "signal_" + versionId + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            logger.error("[SignalController] export 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{versionId}")
    public ResponseEntity<SignalNodeResponseData> getOriginSignal(@PathVariable String versionId) {
        try {
            SignalNodeResponseData result = new SignalNodeResponseData();
            Optional<SignalVersion> signalVersionOpt = signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN);

            boolean hasOriginData = signalVersionOpt.isPresent()
                    && signalVersionOpt.get().getData() != null
                    && !signalVersionOpt.get().getData().isEmpty();

            if (hasOriginData) {
                SignalVersion signalVersion = signalService.getOriginData(versionId);
                result.setSignals(signalVersion.getData());
            } else {
                // ORIGIN이 없거나 비어있으면 XML에서 읽어 DB에 저장
                List<SignalResponse> xmlData = signalService.getDataFromXml(versionId);
                result.setSignals(xmlData);
            }

            return ResponseEntity.ok(result);
        }  catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}