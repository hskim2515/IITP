package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.OsmNetworkValidator;
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

@Slf4j
@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    private final NetworkService networkService;
    private final NetworkMapper networkMapper;
    private final SftpFileManager sftpFileManager;
    private final OsmNetworkValidator validator;

    @GetMapping("/{versionId}")
    public ResponseEntity<NetworkResponse> getNetworkByScenarioKey(@PathVariable String versionId) throws java.io.IOException {
        NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
        NetworkResponse body = networkMapper.toResponse(xml);
        return ResponseEntity.ok(body);
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

    /**
     * network.xml 파일 업로드 → 정합성 검증 → SFTP 저장 → NetworkResponse 반환
     */
    @PostMapping("/{versionId}/import")
    public ResponseEntity<OsmSaveResponse> importNetworkXml(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file
    ) throws Exception {
        log.info("network.xml 임포트: versionId={}, size={}bytes", versionId, file.getSize());

        byte[] xmlBytes = file.getBytes();

        // XML → NetworkXml (JAXB)
        NetworkXml networkXml = networkService.parseAndTransform(versionId, new ByteArrayInputStream(xmlBytes));

        // 정합성 검증
        OsmNetworkValidator.Result validation = validator.validate(networkXml);
        if (!validation.valid()) {
            log.warn("네트워크 검증 실패: {}", validation.errors());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, validation.warnings(), validation.errors()));
        }

        // SFTP 저장 (versionId = 시나리오 키)
        sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
        log.info("SFTP 업로드 완료: {}/network.xml", versionId);

        NetworkResponse response = networkMapper.toResponse(networkXml);
        log.info("임포트 완료: 노드 {}개, 링크 {}개, 경고 {}개",
                response.getNodes() != null ? response.getNodes().size() : 0,
                response.getLinks() != null ? response.getLinks().size() : 0,
                validation.warnings().size());

        return ResponseEntity.ok(new OsmSaveResponse(response, validation.warnings(), validation.errors()));
    }
}
