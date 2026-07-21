package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.service.network.KtdbNetworkConverter;
import com.iitp.iitp_rest.service.network.KtdbStreamingConverter;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.service.network.OsmNetworkValidator;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.simulation.NextSimInputScaffolder;
import com.iitp.iitp_rest.util.FileStorageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.concurrent.CompletableFuture;

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
    private final KtdbStreamingConverter streamingConverter;
    private final NetworkJaxbParser     networkJaxbParser;
    private final NetworkMapper         networkMapper;
    private final OsmNetworkValidator   validator;
    private final FileStorageService    fileStorage;
    private final ScenarioService       scenarioService;
    private final NetworkTileService    networkTileService;
    private final com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService xmlLayerVersionService;
    private final NextSimInputScaffolder nextSimScaffolder;

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
                // 커넥션도 WGS 좌표 필요 — 누락 시 임포트 직후 응답/타일 DB에서 커넥션 위치가 비거나 어긋남
                if (node.getConnections() != null) {
                    node.getConnections().forEach(conn ->
                            conn.setCoordinates(com.iitp.iitp_rest.util.CoordinateUtils.parseAndTransform(
                                    conn.getShape(), originLon, originLat)));
                }
            });
        }
        if (networkXml.getLinks() != null) {
            networkXml.getLinks().forEach(link ->
                    link.setCoordinates(com.iitp.iitp_rest.util.CoordinateUtils.parseAndTransform(
                            link.getShape(), originLon, originLat)));
        }
    }

    // ── 1. SFTP 저장 + JSON 응답 ──────────────────────────────────────────────

    @Operation(summary = "KTDB 표준노드링크 bbox → NetworkXml 직접 변환 → SFTP 저장",
               description = "대형 bbox(전국 포함)는 타일 스트리밍 처리 후 간소화 응답 반환.")
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
        boolean isLarge = KtdbStreamingConverter.LARGE_BBOX_THRESHOLD <
                          (north - south) * (east - west);

        if (isLarge) {
            return handleLargeBbox(south, west, north, east, networkId, versionId);
        }

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
                fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
                log.info("SFTP 업로드 완료: {}/network.xml ({} bytes)", versionId, xmlBytes.length);
                // GET /network 은 DB(xml_layer_versions) 우선 — 옛 편집본 레코드를 지워야 새 XML이 반영된다
                xmlLayerVersionService.deleteVersion("network", versionId);
                try {
                    scenarioService.updateCoordinatesByKey(versionId, ctx.originLat(), ctx.originLon());
                } catch (Exception e) {
                    log.warn("시나리오 좌표 업데이트 실패 (무시): {}", e.getMessage());
                }
            }

            NetworkResponse networkResponse = networkMapper.toResponse(networkXml);
            log.info("KTDB 완료: 노드 {}개, 링크 {}개",
                    networkResponse.getNodes().size(), networkResponse.getLinks().size());

            // 타일 SQLite DB 백그라운드 선빌드 → 첫 타일 요청 즉시 응답 가능
            // + NextSim 필수 입력 정비 — 없으면 생성, 재임포트로 id 가 바뀌어 낡았으면 재생성
            if (versionId != null && !versionId.isBlank()) {
                final String vid = versionId;
                final NetworkResponse resp = networkResponse;
                final java.util.Set<String> allNodeIds = networkXml.getNodes() == null ? java.util.Set.of()
                        : networkXml.getNodes().stream()
                            .map(com.iitp.iitp_rest.model.network.node.NodeXml::getId)
                            .filter(java.util.Objects::nonNull)
                            .map(String::valueOf)
                            .collect(java.util.stream.Collectors.toSet());
                // 터미널은 포트가 1개뿐(out만 있으면 source 후보, in만 있으면 sink 후보) —
                // 부천 실측 odmatrix.xml 관례와 일치시켜 방향이 맞는 OD 만 스캐폴딩
                List<Long> sourceIds = new java.util.ArrayList<>();
                List<Long> sinkIds = new java.util.ArrayList<>();
                // 터미널 로컬좌표(x,y, center="x y") — OD 샘플 수요를 거리 기반(근접 sink 우선)으로
                // 생성해 임의 원거리 쌍보다 그럴듯한 통행 패턴을 만드는 데 사용
                java.util.Map<Long, double[]> terminalCoords = new java.util.HashMap<>();
                if (networkXml.getNodes() != null) {
                    for (var n : networkXml.getNodes()) {
                        if (n.getType() != com.iitp.iitp_rest.model.network.node.NodeType.Terminal
                                || n.getId() == null || n.getPorts() == null || n.getPorts().isEmpty()) continue;
                        var portType = n.getPorts().get(0).getType();
                        if (portType == com.iitp.iitp_rest.model.network.port.PortType.out) sourceIds.add(n.getId());
                        else if (portType == com.iitp.iitp_rest.model.network.port.PortType.in) sinkIds.add(n.getId());
                        if (n.getCenter() != null) {
                            String[] xy = n.getCenter().trim().split("\\s+");
                            if (xy.length == 2) {
                                try {
                                    terminalCoords.put(n.getId(),
                                            new double[]{Double.parseDouble(xy[0]), Double.parseDouble(xy[1])});
                                } catch (NumberFormatException ignored) {}
                            }
                        }
                    }
                }
                final List<Long> finalSourceIds = sourceIds, finalSinkIds = sinkIds;
                final java.util.Map<Long, double[]> finalTerminalCoords = terminalCoords;
                final NetworkXml finalNetworkXml = networkXml;
                CompletableFuture.runAsync(() -> {
                    nextSimScaffolder.scaffoldForImport(vid, allNodeIds, finalSourceIds, finalSinkIds,
                            finalTerminalCoords, finalNetworkXml);
                    try { networkTileService.ingest(vid, resp); }
                    catch (Exception e) { log.warn("[KTDB] 타일 DB 선빌드 실패 (무시): {}", e.getMessage()); }
                });
            }

            return ResponseEntity.ok(new OsmSaveResponse(
                    networkResponse, validation.warnings(), List.of(), List.of(), null, null, null, null, false));

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

    private ResponseEntity<OsmSaveResponse> handleLargeBbox(
            double south, double west, double north, double east,
            int networkId, String versionId) {
        log.info("KTDB 스트리밍 모드 (대형 bbox)");
        try {
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

            KtdbStreamingConverter.StreamResult sr =
                    streamingConverter.streamConvert(
                            south, west, north, east, originLat, originLon, networkId, versionId);

            if (versionId != null && !versionId.isBlank()) {
                try { scenarioService.updateCoordinatesByKey(versionId, originLat, originLon); }
                catch (Exception e) { log.warn("좌표 업데이트 실패 (무시): {}", e.getMessage()); }
                // 스트리밍 경로도 동일 — 옛 DB 편집본이 새 XML을 가리는 것 방지
                xmlLayerVersionService.deleteVersion("network", versionId);
            }

            NetworkResponse simplified = new NetworkResponse();
            simplified.setNodes(sr.nodes());
            simplified.setLinks(sr.links());

            log.info("KTDB 스트리밍 완료: 노드 {}개, 링크 {}개", sr.nodeCount(), sr.linkCount());

            // 타일 SQLite DB 백그라운드 선빌드 → 첫 타일 요청 즉시 응답 가능
            // simplified 기반 빠른 빌드 후 SFTP XML(포트·커넥션·shape 포함) 재빌드 → detail 완전 표시
            if (versionId != null && !versionId.isBlank()) {
                final String vid = versionId;
                final NetworkResponse resp = simplified;
                final List<Long> sourceIds = sr.sourceTerminalIds();
                final List<Long> sinkIds = sr.sinkTerminalIds();
                final java.util.Set<String> allNodeIds = sr.nodes().stream()
                        .map(n -> String.valueOf(n.getId()))
                        .collect(java.util.stream.Collectors.toSet());
                // 터미널 로컬좌표 — 스트리밍 응답은 WGS84(lat/lng)만 가지므로 KtdbStreamingConverter
                // 와 동일한 SCALE_X/SCALE_Y 로 origin 기준 로컬 미터 근사 변환(상대 거리 비교용이라
                // 근사로 충분 — OD 샘플 수요를 근접 sink 우선으로 생성하는 데 사용)
                final double odScaleOriginLat = originLat, odScaleOriginLon = originLon;
                java.util.Map<Long, double[]> terminalCoords = new java.util.HashMap<>();
                for (var n : sr.nodes()) {
                    if (n.getId() == null || n.getCoordinates() == null) continue;
                    Double lat = n.getCoordinates().getLat(), lng = n.getCoordinates().getLng();
                    if (lat == null || lng == null) continue;
                    terminalCoords.put(n.getId(), new double[]{
                            (lng - odScaleOriginLon) * 88000.0,
                            (lat - odScaleOriginLat) * 111000.0,
                    });
                }
                CompletableFuture.runAsync(() -> {
                    // NextSim 필수 입력 정비 — 없으면 생성, 재임포트로 id 변경 시 재생성 (타일 빌드보다 먼저)
                    nextSimScaffolder.scaffoldForImport(vid, allNodeIds, sourceIds, sinkIds, terminalCoords);
                    try { networkTileService.ingest(vid, resp); }   // 1차: simplified 빠른 빌드
                    catch (Exception e) { log.warn("[KTDB] 타일 DB 선빌드 실패 (무시): {}", e.getMessage()); }
                    // 2차: SFTP XML 기반 완전 재빌드 — 1차 실패와 무관하게 항상 시도 (내부 예외 처리)
                    networkTileService.rebuildFromXml(vid);
                });
            }

            return ResponseEntity.ok(new OsmSaveResponse(
                    simplified, sr.warnings(), List.of(), List.of(), null, null, null, null, true));

        } catch (IllegalArgumentException e) {
            log.warn("KTDB 스트리밍 파라미터 오류: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, List.of(e.getMessage())));
        } catch (Exception e) {
            log.error("KTDB 스트리밍 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new OsmSaveResponse(null, List.of(e.getMessage())));
        }
    }

    // ── 줌인 상세 조회 (LOD) ──────────────────────────────────────────────────

    @Operation(summary = "줌인 viewport bbox에 대한 상세 KTDB NetworkResponse",
               description = "전체 가져오기 후 zoom-in 시 해당 영역의 상세 데이터를 요청하는 용도.")
    @GetMapping("/ktdb/detail")
    public ResponseEntity<NetworkResponse> importKtdbDetail(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "Network id (기본: 0)") @RequestParam(defaultValue = "0") int networkId
    ) {
        if (KtdbStreamingConverter.LARGE_BBOX_THRESHOLD < (north - south) * (east - west)) {
            log.warn("detail 요청 bbox가 너무 큽니다. 더 좁은 영역을 선택하세요.");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        }
        log.info("KTDB Detail: bbox=({},{},{},{})", south, west, north, east);
        try {
            KtdbContext ctx = build(south, west, north, east, networkId, null);
            return ResponseEntity.ok(networkMapper.toResponse(ctx.networkXml()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).build();
        } catch (Exception e) {
            log.error("KTDB Detail 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
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
