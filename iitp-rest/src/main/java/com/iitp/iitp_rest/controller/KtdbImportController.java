package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.service.network.*;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.util.SftpFileManager;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayInputStream;
import java.util.List;

/**
 * KTDB 표준노드링크 → NetworkXml 직접 변환 (netconvert 없음)
 *
 * POST /network/import/ktdb/save  → SFTP 저장 + OsmSaveResponse
 * POST /network/import/ktdb/json  → NetworkResponse JSON (저장 없음)
 *
 * KTDB는 이미 교차로에서 정확히 분할된 링크 구조이므로
 * netconvert 없이 PostgreSQL → NetworkXml 직접 변환.
 */
@Log4j2
@Tag(name = "KTDB Import", description = "표준노드링크(PostgreSQL) → NetworkXml 직접 변환")
@RestController
@RequestMapping("/network/import")
@AllArgsConstructor
public class KtdbImportController {

    private final KtdbNetworkConverter  ktdbConverter;
    private final OsmFacilityConverter  facilityConverter;
    private final OsmOverpassService    overpassService;
    private final NetworkJaxbParser     networkJaxbParser;
    private final NetworkMapper         networkMapper;
    private final OsmNetworkValidator   validator;
    private final SftpFileManager       sftpFileManager;
    private final ScenarioService       scenarioService;

    // ── 공통 변환 로직 ────────────────────────────────────────────────────────

    private record KtdbContext(NetworkXml networkXml, double originLat, double originLon) {}

    private KtdbContext build(
            double south, double west, double north, double east,
            int networkId, String versionId) {

        double originLat = (south + north) / 2.0;
        double originLon = (west  + east)  / 2.0;
        if (versionId != null && !versionId.isBlank()) {
            try {
                Scenario s = scenarioService.existsByKey(versionId)
                        ? scenarioService.getScenarioByKey(versionId) : null;
                if (s != null && s.getLatitude() != null && s.getLongitude() != null
                        && (s.getLatitude() != 0.0 || s.getLongitude() != 0.0)) {
                    originLat = s.getLatitude();
                    originLon = s.getLongitude();
                }
            } catch (Exception ignored) {}
        }

        log.info("KTDB 변환 시작: bbox=({},{},{},{}), 원점=({},{})",
                south, west, north, east, originLat, originLon);

        KtdbNetworkConverter.ConvertResult result =
                ktdbConverter.convert(south, west, north, east, originLat, originLon, networkId);

        NetworkXml networkXml = result.networkXml();
        networkXml.setBaseLat(originLat);
        networkXml.setBaseLon(originLon);

        // WGS84 좌표 설정 — Cesium 렌더링에 필수
        applyCoordinates(networkXml, originLon, originLat);

        return new KtdbContext(networkXml, originLat, originLon);
    }

    private void applyCoordinates(NetworkXml networkXml, double originLon, double originLat) {
        if (networkXml.getNodes() != null) {
            networkXml.getNodes().forEach(node -> {
                var coords = com.iitp.iitp_rest.util.CoordinateUtils.parseAndTransform(
                        node.getCenter(), originLon, originLat);
                if (!coords.isEmpty()) node.setCoordinates(coords.getFirst());
            });
        }
        if (networkXml.getLinks() != null) {
            networkXml.getLinks().forEach(link ->
                    link.setCoordinates(com.iitp.iitp_rest.util.CoordinateUtils.parseAndTransform(
                            link.getShape(), originLon, originLat)));
        }
    }

    // ── 1. SFTP 저장 + JSON 응답 ──────────────────────────────────────────────

    @Operation(summary = "KTDB 표준노드링크 bbox → NetworkXml 직접 변환 → SFTP 저장")
    @PostMapping(value = "/ktdb/save", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<OsmSaveResponse> importKtdbSave(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId,
            @Parameter(description = "시나리오 버전 키 (SFTP 저장 경로)") @RequestParam(required = false) String versionId
    ) {
        log.info("KTDB Save: bbox=({},{},{},{}), versionId={}", south, west, north, east, versionId);
        try {
            KtdbContext ctx = build(south, west, north, east, networkId, versionId);
            NetworkXml networkXml = ctx.networkXml();

            OsmNetworkValidator.Result validation = validator.validate(networkXml);
            if (!validation.valid()) {
                log.warn("네트워크 검증 실패: {}", validation.errors());
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(new OsmSaveResponse(null, validation.errors()));
            }

            if (versionId != null && !versionId.isBlank()) {
                byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
                sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
                log.info("SFTP 업로드 완료: {}/network.xml ({} bytes)", versionId, xmlBytes.length);
                try {
                    scenarioService.updateCoordinatesByKey(versionId, ctx.originLat(), ctx.originLon());
                } catch (Exception e) {
                    log.warn("시나리오 좌표 업데이트 실패 (무시): {}", e.getMessage());
                }
            }

            NetworkResponse networkResponse = networkMapper.toResponse(networkXml);

            // 시설물은 Overpass에서 별도 추출
            OsmOverpassService.FacilityQueryResult facilityRaw =
                    overpassService.queryFacilities(south, west, north, east);
            OsmFacilityConverter.FacilityResult fac =
                    facilityConverter.convert(facilityRaw, networkXml,
                            ctx.originLat(), ctx.originLon(),
                            new double[]{south, west, north, east});

            log.info("KTDB 완료: 노드 {}개, 링크 {}개",
                    networkResponse.getNodes().size(), networkResponse.getLinks().size());

            return ResponseEntity.ok(new OsmSaveResponse(
                    networkResponse, validation.warnings(), List.of(),
                    List.of(),
                    fac.busStations(), fac.railStations(),
                    fac.busRoutes(), fac.railRoutes()));

        } catch (IllegalArgumentException e) {
            log.warn("KTDB Save 파라미터 오류: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, List.of(e.getMessage())));
        } catch (Exception e) {
            log.error("KTDB Save 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new OsmSaveResponse(null, List.of(e.getMessage())));
        }
    }

    // ── 2. JSON 응답 (저장 없음) ──────────────────────────────────────────────

    @Operation(summary = "KTDB 표준노드링크 bbox → NetworkResponse JSON (저장 없음)")
    @PostMapping(value = "/ktdb/json", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<NetworkResponse> importKtdbJson(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId
    ) {
        log.info("KTDB JSON: bbox=({},{},{},{})", south, west, north, east);
        try {
            KtdbContext ctx = build(south, west, north, east, networkId, null);
            return ResponseEntity.ok(networkMapper.toResponse(ctx.networkXml()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).build();
        } catch (Exception e) {
            log.error("KTDB JSON 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
