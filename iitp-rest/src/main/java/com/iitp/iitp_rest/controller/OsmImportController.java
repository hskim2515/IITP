package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.service.network.OsmNetworkValidator;
import com.iitp.iitp_rest.model.osm.OsmNode;
import com.iitp.iitp_rest.model.osm.OsmWay;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.OsmNetworkConverter;
import com.iitp.iitp_rest.service.network.OsmOverpassService;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.SftpFileManager;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * OSM → network 임포트 엔드포인트
 *
 * GET /network/import/osm        → network.xml 파일 다운로드
 * GET /network/import/osm/json   → NetworkResponse JSON (지도 교체용)
 */
@Log4j2
@Tag(name = "OSM Import", description = "OSM 도로 데이터 → network 변환")
@RestController
@RequestMapping("/network/import")
@AllArgsConstructor
public class OsmImportController {

    private final OsmOverpassService overpassService;
    private final OsmNetworkConverter converter;
    private final NetworkJaxbParser networkJaxbParser;
    private final NetworkMapper networkMapper;
    private final SftpFileManager sftpFileManager;
    private final OsmNetworkValidator validator;
    private final ScenarioService scenarioService;

    // ── 공통: Overpass 호출 + XML 생성 ──────────────────────────────────────

    private record OsmConvertResult(String xml, double originLat, double originLon) {}

    private OsmConvertResult buildXml(double south, double west, double north, double east,
                                      Double baseLat, Double baseLon, int networkId, String versionId) {
        double originLat;
        double originLon;
        if (baseLat != null && baseLon != null) {
            originLat = baseLat;
            originLon = baseLon;
        } else {
            // scenario 저장 좌표를 기본 origin으로 사용 (NetworkService 재로드 시와 동일한 원점)
            Double scenarioLat = null, scenarioLon = null;
            if (versionId != null && !versionId.isBlank()) {
                try {
                    Scenario scenario = scenarioService.existsByKey(versionId)
                            ? scenarioService.getScenarioByKey(versionId)
                            : null;
                    if (scenario != null && scenario.getLatitude() != null && scenario.getLongitude() != null
                            && (scenario.getLatitude() != 0.0 || scenario.getLongitude() != 0.0)) {
                        scenarioLat = scenario.getLatitude();
                        scenarioLon = scenario.getLongitude();
                    }
                } catch (Exception ignored) {}
            }
            originLat = (scenarioLat != null) ? scenarioLat : (south + north) / 2.0;
            originLon = (scenarioLon != null) ? scenarioLon : (west  + east)  / 2.0;
        }

        Map<String, Object> osmData = overpassService.queryBbox(south, west, north, east);
        @SuppressWarnings("unchecked")
        List<OsmNode> nodes = (List<OsmNode>) osmData.get("nodes");
        @SuppressWarnings("unchecked")
        List<OsmWay> ways   = (List<OsmWay>) osmData.get("ways");

        log.info("변환 시작: 노드 {}개, way {}개, 원점 lat={} lon={}",
                nodes.size(), ways.size(), originLat, originLon);

        String xml = converter.convert(nodes, ways, originLat, originLon, networkId);
        return new OsmConvertResult(xml, originLat, originLon);
    }

    // ── 1. XML 다운로드 ──────────────────────────────────────────────────────

    @Operation(summary = "OSM bbox → network.xml 다운로드")
    @GetMapping("/osm")
    public ResponseEntity<byte[]> importFromOsmXml(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "원점 위도 (생략 시 bbox 중심)") @RequestParam(required = false) Double baseLat,
            @Parameter(description = "원점 경도 (생략 시 bbox 중심)") @RequestParam(required = false) Double baseLon,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId
    ) {
        log.info("OSM XML 임포트: bbox=({},{},{},{})", south, west, north, east);
        OsmConvertResult result = buildXml(south, west, north, east, baseLat, baseLon, networkId, null);
        byte[] body = result.xml().getBytes(StandardCharsets.UTF_8);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_XML);
        headers.setContentDispositionFormData("attachment", "network.xml");
        headers.setContentLength(body.length);

        log.info("XML 변환 완료: {}bytes", body.length);
        return ResponseEntity.ok().headers(headers).body(body);
    }

    // ── 2. JSON 응답 (지도에 바로 교체) ─────────────────────────────────────

    @Operation(summary = "OSM bbox → NetworkResponse JSON (지도 교체용)",
               description = "변환된 네트워크를 JSON으로 반환합니다. 프론트에서 store에 직접 주입해 지도에 표시합니다.")
    @GetMapping("/osm/json")
    public ResponseEntity<NetworkResponse> importFromOsmJson(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "원점 위도 (생략 시 bbox 중심)") @RequestParam(required = false) Double baseLat,
            @Parameter(description = "원점 경도 (생략 시 bbox 중심)") @RequestParam(required = false) Double baseLon,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId
    ) {
        log.info("OSM JSON 임포트: bbox=({},{},{},{})", south, west, north, east);

        // XML 생성
        OsmConvertResult result = buildXml(south, west, north, east, baseLat, baseLon, networkId, null);

        // XML → NetworkXml (JAXB)
        NetworkXml networkXml = networkJaxbParser.parse(
                new ByteArrayInputStream(result.xml().getBytes(StandardCharsets.UTF_8))
        );

        // 로컬 좌표 → WGS84 변환 (center 속성 기반)
        if (networkXml.getNodes() != null) {
            networkXml.getNodes().forEach(node -> {
                var coords = CoordinateUtils.parseAndTransform(
                        node.getCenter(), result.originLon(), result.originLat()
                );
                if (!coords.isEmpty()) node.setCoordinates(coords.getFirst());
            });
        }
        if (networkXml.getLinks() != null) {
            networkXml.getLinks().forEach(link ->
                    link.setCoordinates(CoordinateUtils.parseAndTransform(
                            link.getShape(), result.originLon(), result.originLat()
                    ))
            );
        }

        NetworkResponse response = networkMapper.toResponse(networkXml);
        log.info("JSON 변환 완료: 노드 {}개, 링크 {}개",
                response.getNodes() != null ? response.getNodes().size() : 0,
                response.getLinks() != null ? response.getLinks().size() : 0);

        return ResponseEntity.ok(response);
    }

    // ── 3. SFTP 저장 + JSON 응답 ─────────────────────────────────────────────

    @Operation(summary = "OSM bbox → 정합성 검증 + network.xml SFTP 저장 + OsmSaveResponse 반환",
               description = "변환된 XML을 검증하고, 오류가 없으면 서버에 저장 후 JSON과 경고 목록을 반환합니다.")
    @GetMapping("/osm/save")
    public ResponseEntity<OsmSaveResponse> importAndSave(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "원점 위도 (생략 시 bbox 중심)") @RequestParam(required = false) Double baseLat,
            @Parameter(description = "원점 경도 (생략 시 bbox 중심)") @RequestParam(required = false) Double baseLon,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId,
            @Parameter(description = "시나리오 버전 키 (SFTP 저장 경로)") @RequestParam String versionId
    ) throws Exception {
        log.info("OSM Save 임포트: bbox=({},{},{},{}), versionId={}", south, west, north, east, versionId);

        // XML 생성 (baseLat/baseLon 미입력 시 scenario 좌표를 origin으로 사용)
        OsmConvertResult result = buildXml(south, west, north, east, baseLat, baseLon, networkId, versionId);
        byte[] xmlBytes = result.xml().getBytes(StandardCharsets.UTF_8);

        // XML → NetworkXml (JAXB)
        NetworkXml networkXml = networkJaxbParser.parse(new ByteArrayInputStream(xmlBytes));

        // 정합성 검증
        OsmNetworkValidator.Result validation = validator.validate(networkXml);
        if (!validation.valid()) {
            log.warn("네트워크 검증 실패: {}", validation.errors());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, validation.errors()));
        }

        // SFTP 업로드: {basePath}/{versionId}/network.xml (versionId = 시나리오 키)
        sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
        log.info("SFTP 업로드 완료: {}/network.xml", versionId);

        // 로컬 좌표 → WGS84 변환
        if (networkXml.getNodes() != null) {
            networkXml.getNodes().forEach(node -> {
                var coords = CoordinateUtils.parseAndTransform(
                        node.getCenter(), result.originLon(), result.originLat()
                );
                if (!coords.isEmpty()) node.setCoordinates(coords.getFirst());
            });
        }
        if (networkXml.getLinks() != null) {
            networkXml.getLinks().forEach(link ->
                    link.setCoordinates(CoordinateUtils.parseAndTransform(
                            link.getShape(), result.originLon(), result.originLat()
                    ))
            );
        }

        NetworkResponse networkResponse = networkMapper.toResponse(networkXml);
        log.info("저장 및 JSON 변환 완료: 노드 {}개, 링크 {}개, 경고 {}개",
                networkResponse.getNodes() != null ? networkResponse.getNodes().size() : 0,
                networkResponse.getLinks() != null ? networkResponse.getLinks().size() : 0,
                validation.warnings().size());

        return ResponseEntity.ok(new OsmSaveResponse(networkResponse, validation.warnings()));
    }
}
