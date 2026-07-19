package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.service.network.*;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.FileStorageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayInputStream;
import java.util.List;

/**
 * OSM → SUMO netconvert → network 임포트 엔드포인트 (명시적 SUMO 경로)
 *
 * GET /network/import/sumo/json  → NetworkResponse JSON
 * GET /network/import/sumo/save  → SFTP 저장 + OsmSaveResponse (신호 포함)
 * GET /network/import/sumo       → network.xml 파일 다운로드
 */
@Log4j2
@Tag(name = "SUMO Import", description = "OSM → SUMO netconvert 기반 네트워크 자동 생성")
@RestController
@RequestMapping("/network/import")
@AllArgsConstructor
public class SumoImportController {

    private final OsmOverpassService   overpassService;
    private final NetconvertRunner     netconvertRunner;
    private final SumoNetConverter     sumoNetConverter;
    private final OsmFacilityConverter facilityConverter;
    private final NetworkJaxbParser    networkJaxbParser;
    private final NetworkMapper        networkMapper;
    private final OsmNetworkValidator  validator;
    private final FileStorageService fileStorage;
    private final ScenarioService      scenarioService;
    private final com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService xmlLayerVersionService;

    // ── 공통 변환 로직 ────────────────────────────────────────────────────────

    private record SumoConvertContext(SumoNetConverter.ConvertResult result,
                                       OsmFacilityConverter.FacilityResult facilities,
                                       double originLat, double originLon) {}

    private SumoConvertContext build(
            double south, double west, double north, double east,
            Double baseLat, Double baseLon, int networkId, String versionId) throws Exception {

        double originLat, originLon;
        if (baseLat != null && baseLon != null) {
            originLat = baseLat;
            originLon = baseLon;
        } else {
            Double scenLat = null, scenLon = null;
            if (versionId != null && !versionId.isBlank()) {
                try {
                    Scenario s = scenarioService.existsByKey(versionId)
                            ? scenarioService.getScenarioByKey(versionId) : null;
                    if (s != null && s.getLatitude() != null && s.getLongitude() != null
                            && (s.getLatitude() != 0.0 || s.getLongitude() != 0.0)) {
                        scenLat = s.getLatitude();
                        scenLon = s.getLongitude();
                    }
                } catch (Exception ignored) {}
            }
            originLat = scenLat != null ? scenLat : (south + north) / 2.0;
            originLon = scenLon != null ? scenLon : (west  + east)  / 2.0;
        }

        log.info("SUMO 변환 시작: bbox=({},{},{},{}), 원점=({},{})",
                south, west, north, east, originLat, originLon);

        byte[] osmXml  = overpassService.queryBboxAsXml(south, west, north, east);
        byte[] sumoNet = netconvertRunner.run(osmXml);
        SumoNetConverter.ConvertResult result =
                sumoNetConverter.convert(sumoNet, originLat, originLon, networkId);

        applyCoordinates(result.networkXml(), originLon, originLat);
        return new SumoConvertContext(result, null, originLat, originLon);
    }

    private void applyCoordinates(NetworkXml networkXml, double originLon, double originLat) {
        if (networkXml.getNodes() != null) {
            networkXml.getNodes().forEach(node -> {
                var coords = CoordinateUtils.parseAndTransform(
                        node.getCenter(), originLon, originLat);
                if (!coords.isEmpty()) node.setCoordinates(coords.getFirst());
                // 커넥션도 WGS 좌표 필요 — 누락 시 임포트 직후 응답에서 커넥션 위치가 비거나 어긋남
                if (node.getConnections() != null) {
                    node.getConnections().forEach(conn ->
                            conn.setCoordinates(CoordinateUtils.parseAndTransform(
                                    conn.getShape(), originLon, originLat)));
                }
            });
        }
        if (networkXml.getLinks() != null) {
            networkXml.getLinks().forEach(link ->
                    link.setCoordinates(CoordinateUtils.parseAndTransform(
                            link.getShape(), originLon, originLat)));
        }
    }

    // ── 1. JSON 응답 ──────────────────────────────────────────────────────────

    @Operation(summary = "OSM bbox → SUMO netconvert → NetworkResponse JSON")
    @GetMapping("/sumo/json")
    public ResponseEntity<NetworkResponse> importSumoJson(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "원점 위도") @RequestParam(required = false) Double baseLat,
            @Parameter(description = "원점 경도") @RequestParam(required = false) Double baseLon,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId
    ) {
        log.info("SUMO JSON 임포트: bbox=({},{},{},{})", south, west, north, east);
        try {
            SumoConvertContext ctx = build(south, west, north, east, baseLat, baseLon, networkId, null);
            NetworkResponse response = networkMapper.toResponse(ctx.result().networkXml());
            log.info("JSON 변환 완료: 노드 {}개, 링크 {}개, 신호 {}개",
                    response.getNodes().size(), response.getLinks().size(),
                    ctx.result().signals().size());
            return ResponseEntity.ok(response);
        } catch (RuntimeException e) {
            log.error("SUMO JSON 변환 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        } catch (Exception e) {
            log.error("SUMO JSON 변환 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // ── 2. SFTP 저장 + JSON 응답 ──────────────────────────────────────────────

    @Operation(summary = "OSM bbox → SUMO netconvert → 검증 + SFTP 저장 + OsmSaveResponse")
    @GetMapping("/sumo/save")
    public ResponseEntity<OsmSaveResponse> importSumoSave(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "원점 위도") @RequestParam(required = false) Double baseLat,
            @Parameter(description = "원점 경도") @RequestParam(required = false) Double baseLon,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId,
            @Parameter(description = "시나리오 버전 키 (SFTP 저장 경로)") @RequestParam String versionId
    ) {
        log.info("SUMO Save: bbox=({},{},{},{}), versionId={}", south, west, north, east, versionId);
        try {
            SumoConvertContext ctx = build(south, west, north, east, baseLat, baseLon, networkId, versionId);
            NetworkXml networkXml = ctx.result().networkXml();

            OsmNetworkValidator.Result validation = validator.validate(networkXml);
            if (!validation.valid()) {
                log.warn("네트워크 검증 실패: {}", validation.errors());
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(new OsmSaveResponse(null, validation.errors()));
            }

            networkXml.setBaseLat(ctx.originLat());
            networkXml.setBaseLon(ctx.originLon());

            byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
            log.info("SFTP 업로드 완료: {}/network.xml ({} bytes)", versionId, xmlBytes.length);
            // GET /network 은 DB(xml_layer_versions) 우선 — 옛 편집본 레코드를 지워야 새 XML이 반영된다
            xmlLayerVersionService.deleteVersion("network", versionId);

            // import 시 사용한 origin 좌표를 시나리오에 저장 → 재로드 시 일치 보장
            try {
                scenarioService.updateCoordinatesByKey(versionId, ctx.originLat(), ctx.originLon());
                log.info("시나리오 좌표 업데이트: ({}, {})", ctx.originLat(), ctx.originLon());
            } catch (Exception e) {
                log.warn("시나리오 좌표 업데이트 실패 (무시): {}", e.getMessage());
            }

            NetworkResponse networkResponse = networkMapper.toResponse(networkXml);

            // 시설물 추출 (save에서만 실행)
            OsmOverpassService.FacilityQueryResult facilityRaw =
                    overpassService.queryFacilities(south, west, north, east);
            OsmFacilityConverter.FacilityResult fac =
                    facilityConverter.convert(facilityRaw, networkXml, ctx.originLat(), ctx.originLon(), new double[]{south, west, north, east});

            return ResponseEntity.ok(new OsmSaveResponse(
                    networkResponse, validation.warnings(), List.of(),
                    ctx.result().signals(),
                    fac.busStations(), fac.railStations(),
                    fac.busRoutes(), fac.railRoutes(), false));

        } catch (RuntimeException e) {
            log.error("SUMO Save 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new OsmSaveResponse(null, java.util.List.of(e.getMessage())));
        } catch (Exception e) {
            log.error("SUMO Save 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new OsmSaveResponse(null, java.util.List.of(e.getMessage())));
        }
    }

    // ── 3. XML 다운로드 ───────────────────────────────────────────────────────

    @Operation(summary = "OSM bbox → SUMO netconvert → network.xml 다운로드")
    @GetMapping("/sumo")
    public ResponseEntity<byte[]> importSumoXml(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "원점 위도") @RequestParam(required = false) Double baseLat,
            @Parameter(description = "원점 경도") @RequestParam(required = false) Double baseLon,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId
    ) {
        log.info("SUMO XML 다운로드: bbox=({},{},{},{})", south, west, north, east);
        try {
            SumoConvertContext ctx = build(south, west, north, east, baseLat, baseLon, networkId, null);
            byte[] xmlBytes = networkJaxbParser.marshal(ctx.result().networkXml());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "network.xml");
            headers.setContentLength(xmlBytes.length);
            return ResponseEntity.ok().headers(headers).body(xmlBytes);
        } catch (Exception e) {
            log.error("SUMO XML 다운로드 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
