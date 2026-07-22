package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.signal.*;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import com.iitp.iitp_rest.service.signal.SignalJaxbParser;
import com.iitp.iitp_rest.service.signal.SignalService;
import com.iitp.iitp_rest.service.signal.SignalTileService;
import com.iitp.iitp_rest.service.simulation.NextSimInputScaffolder;
import com.iitp.iitp_rest.util.FileStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.util.*;

@RestController
@RequestMapping("/signal")
public class SignalController {
    private final Logger logger = LoggerFactory.getLogger(this.getClass());
    private final SignalService signalService;
    private final SignalTileService signalTileService;
    private final SignalVersionsRepository signalVersionsRepository;
    private final SignalJaxbParser signalJaxbParser;
    private final FileStorageService fileStorage;
    private final NextSimInputScaffolder nextSimInputScaffolder;

    public SignalController(SignalService signalService, SignalTileService signalTileService,
                            SignalVersionsRepository signalVersionsRepository,
                            SignalJaxbParser signalJaxbParser, FileStorageService fileStorage,
                            NextSimInputScaffolder nextSimInputScaffolder) {
        this.signalService = signalService;
        this.signalTileService = signalTileService;
        this.signalVersionsRepository = signalVersionsRepository;
        this.signalJaxbParser = signalJaxbParser;
        this.fileStorage = fileStorage;
        this.nextSimInputScaffolder = nextSimInputScaffolder;
    }

    /**
     * signalTOD.xml을 signal.xml의 플랜 보유 노드와 다시 맞춘다(KTDB 재임포트 없이 즉시 실행).
     * signal.xml에 플랜이 있는 노드인데 TOD 일정이 없으면 NextSim이 크래시하는데, 이 정합은
     * 원래 KTDB 재임포트마다 자동으로 돌던 것 — 그 로직이 생기기 전에 이미 임포트된 버전은
     * 재임포트를 다시 하지 않는 한 낡은 상태로 방치된다. signal.xml 자체는 건드리지 않는다.
     */
    @PostMapping("/{versionId}/repair-tod")
    public ResponseEntity<Map<String, Boolean>> repairSignalTod(@PathVariable String versionId) {
        boolean repaired = nextSimInputScaffolder.repairSignalTod(versionId);
        return ResponseEntity.ok(Map.of("repaired", repaired));
    }

    /**
     * 신호 BBox 타일링 조회 (읽기 전용) — viewport 와 교차하는 신호만 반환.
     * 신호는 네트워크 노드에 종속 → 네트워크 노드 좌표로 bbox 산정. 기존 {@code GET /{versionId}} 와 병존.
     */
    @GetMapping("/{versionId}/tiles")
    public ResponseEntity<SignalNodeResponseData> getSignalTiles(
            @PathVariable String versionId,
            @RequestParam String bbox) {
        try {
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            SignalNodeResponseData result = new SignalNodeResponseData();
            result.setSignals(signalTileService.queryByBbox(versionId, west, south, east, north));
            return ResponseEntity.ok(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            logger.error("[SignalController] 타일 조회 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
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

    } catch (java.io.IOException e) {
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
    public ResponseEntity<Void> saveSignal(@RequestBody SignalSaveRequest request, @PathVariable String versionId) {
        logger.info("[saveSignal] versionId={} signals={}", versionId, request.getData() != null ? request.getData().size() : 0);
        try {
            signalService.saveSignal(request, versionId);
            // DB 저장과 동시에 signal.xml 파일도 동기화
            try {
                SignalXml xml = signalService.toSignalXml(request.getData() != null ? request.getData() : List.of());
                byte[] xmlBytes = signalJaxbParser.marshal(xml);
                fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "signal.xml");
                logger.info("[saveSignal] signal.xml 저장 완료: {}/signal.xml", versionId);
            } catch (Exception e) {
                logger.warn("[saveSignal] signal.xml 파일 저장 실패 (DB는 정상 저장됨): {}", e.getMessage());
            }
            // 타일 캐시 무효화 + 즉시 재빌드 (방금 받은 신호 목록 재사용 → signal.xml 재파싱 없이).
            // 첫 신호 타일 요청(~3s lazy 빌드)을 저장 처리 시간으로 흡수.
            try {
                signalTileService.invalidate(versionId);
                signalTileService.ingest(versionId, request.getData() != null ? request.getData() : List.of());
            } catch (Exception e) {
                logger.warn("[saveSignal] 신호 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
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

    /** signal.xml 파일 업로드 → 파싱(flat 변환) + DB 저장 + SFTP 동기화 + 신호 타일 재빌드 */
    @PostMapping("/{versionId}/import")
    public ResponseEntity<SignalNodeResponseData> importSignalXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) {
        logger.info("[SignalController] IMPORT versionId={}, size={}bytes", versionId, file.getSize());
        try {
            byte[] xmlBytes = file.getBytes();
            SignalXml parsed = signalJaxbParser.parse(new ByteArrayInputStream(xmlBytes));
            List<SignalResponse> flat = signalService.fromSignalXml(parsed);

            SignalSaveRequest request = new SignalSaveRequest();
            request.setData(flat);
            request.setLogs(new com.iitp.iitp_rest.model.LogsData());
            signalService.saveSignal(request, versionId);

            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "signal.xml");

            try {
                signalTileService.invalidate(versionId);
                signalTileService.ingest(versionId, flat);
            } catch (Exception e) {
                logger.warn("[importSignalXml] 신호 타일 사전 빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }

            SignalNodeResponseData result = new SignalNodeResponseData();
            result.setSignals(flat);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            logger.error("[SignalController] 임포트 오류", e);
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