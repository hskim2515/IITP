package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.OsmNetworkValidator;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import com.iitp.iitp_rest.util.SftpFileManager;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    static final String LAYER_KEY = "network";

    private final NetworkService networkService;
    private final NetworkMapper networkMapper;
    private final NetworkJaxbParser networkJaxbParser;
    private final SftpFileManager sftpFileManager;
    private final OsmNetworkValidator validator;
    private final XmlLayerVersionService xmlLayerVersionService;
    private final ScenarioVersionRepository scenarioVersionRepository;
    private final ScenarioService scenarioService;

    /** DB 우선, 없으면 XML fallback → NetworkResponse 반환 */
    @GetMapping("/{versionId}")
    public ResponseEntity<Map<String, Object>> getNetworkByVersionId(@PathVariable String versionId) {
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, versionId,
                    () -> {
                        try {
                            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
                            NetworkResponse resp = networkMapper.toResponse(xml);
                            return XmlLayerConverter.toMap(resp);
                        } catch (java.io.FileNotFoundException e) { throw new RuntimeException(e); }
                          catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.FileNotFoundException) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }
            throw e;
        }
    }

    /** 항상 XML 원본 반환 */
    @GetMapping("/origin/{versionId}")
    public ResponseEntity<Map<String, Object>> getOriginNetwork(@PathVariable String versionId) {
        try {
            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
            NetworkResponse resp = networkMapper.toResponse(xml);
            return ResponseEntity.ok(XmlLayerConverter.toMap(resp));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[NetworkController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 변경 이력 목록 */
    @GetMapping("/histories/{versionId}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String versionId) {
        log.info("[NetworkController] GET histories versionId={}", versionId);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, versionId));
    }

    /** DB 저장 + 로그 추가 */
    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveNetwork(
            @PathVariable String versionId,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[NetworkController] POST versionId={}", versionId);
        try {
            xmlLayerVersionService.save(LAYER_KEY, versionId, request.getData(), request.getLogs());
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[NetworkController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** 현재 DB(또는 XML) 데이터를 network.xml 파일로 내보내기 */
    @GetMapping("/{versionId}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String versionId) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(
                    LAYER_KEY, versionId,
                    () -> {
                        try {
                            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
                            NetworkResponse resp = networkMapper.toResponse(xml);
                            return com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter.toMap(resp);
                        } catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            NetworkResponse response = com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter.fromMap(data, NetworkResponse.class);
            NetworkXml networkXml = networkMapper.fromResponse(response);
            byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "network_" + versionId + ".xml");
            headers.setContentLength(xmlBytes.length);
            return ResponseEntity.ok().headers(headers).body(xmlBytes);
        } catch (Exception e) {
            log.error("[NetworkController] export 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/{versionId}/backup")
    public ResponseEntity<byte[]> downloadBackup(@PathVariable String versionId) throws java.io.IOException {
        byte[] body = networkService.getRawXmlBytes(versionId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_XML);
        headers.setContentDispositionFormData("attachment", "network_backup_" + versionId + ".xml");
        headers.setContentLength(body.length);
        return ResponseEntity.ok().headers(headers).body(body);
    }

    @PostMapping("/{versionId}/import")
    public ResponseEntity<OsmSaveResponse> importNetworkXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "latitude",  required = false) Double latitude,
            @RequestParam(value = "longitude", required = false) Double longitude
    ) throws Exception {
        log.info("network.xml 임포트: versionId={}, size={}bytes, lat={}, lon={}", versionId, file.getSize(), latitude, longitude);

        // 좌표가 파라미터로 주어지지 않았고 DB에도 없으면 클라이언트에 입력 요청
        if (latitude == null && longitude == null && networkService.hasMissingCoordinates(versionId)) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, List.of(), List.of("MISSING_COORDINATES")));
        }

        byte[] xmlBytes = file.getBytes();
        NetworkXml networkXml = networkService.parseAndTransform(versionId, new ByteArrayInputStream(xmlBytes), latitude, longitude);

        OsmNetworkValidator.Result validation = validator.validate(networkXml);
        if (!validation.valid()) {
            log.warn("네트워크 검증 실패: {}", validation.errors());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, validation.warnings(), validation.errors()));
        }

        String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
        sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "network.xml");
        log.info("SFTP 업로드 완료: {}/network.xml (scenarioKey={}, versionId={})", scenarioKey, scenarioKey, versionId);

        // 좌표를 파라미터로 받았다면 DB에 영구 저장 (이후 로드 시에도 동일 좌표 사용)
        if (latitude != null && longitude != null) {
            scenarioService.updateCoordinatesByKey(versionId, latitude, longitude);
            log.info("시나리오 기준 좌표 저장 완료: versionId={}, lat={}, lon={}", versionId, latitude, longitude);
        }

        NetworkResponse response = networkMapper.toResponse(networkXml);
        log.info("임포트 완료: 노드 {}개, 링크 {}개",
                response.getNodes() != null ? response.getNodes().size() : 0,
                response.getLinks() != null ? response.getLinks().size() : 0);

        return ResponseEntity.ok(new OsmSaveResponse(response, validation.warnings(), validation.errors()));
    }
}
