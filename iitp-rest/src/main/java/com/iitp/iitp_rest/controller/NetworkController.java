package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkDiffRequest;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingLogsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.repository.SignalLogsRepository;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import com.iitp.iitp_rest.repository.VehicleRouteRepository;
import com.iitp.iitp_rest.repository.XmlLayerLogRepository;
import com.iitp.iitp_rest.repository.XmlLayerVersionRepository;
import com.iitp.iitp_rest.service.network.NetworkIdNormalizer;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.service.network.NetworkReachabilityService;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.service.network.OsmNetworkValidator;
import com.iitp.iitp_rest.service.odmatrix.OdMatrixService;
import com.iitp.iitp_rest.service.odmatrix.OdTerminalIdBandService;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import com.iitp.iitp_rest.util.FileStorageService;
import com.iitp.iitp_rest.util.VehicleDataReader;
import org.springframework.transaction.annotation.Transactional;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Slf4j
@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    static final String LAYER_KEY = "network";

    private final NetworkService networkService;
    private final NetworkTileService networkTileService;
    private final NetworkReachabilityService networkReachabilityService;
    private final com.iitp.iitp_rest.service.network.NetworkStreamingDiffService networkStreamingDiffService;
    private final NetworkIdNormalizer networkIdNormalizer;
    private final OdTerminalIdBandService odTerminalIdBandService;
    private final OdMatrixService odMatrixService;
    private final NetworkMapper networkMapper;
    private final NetworkJaxbParser networkJaxbParser;
    private final FileStorageService fileStorage;
    private final OsmNetworkValidator validator;
    private final XmlLayerVersionService xmlLayerVersionService;
    private final ScenarioVersionRepository scenarioVersionRepository;
    private final ScenarioService scenarioService;
    private final SignalVersionsRepository signalVersionsRepository;
    private final SignalLogsRepository signalLogsRepository;
    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;
    private final RailStationVersionsRepository railStationVersionsRepository;
    private final RailStationLogsRepository railStationLogsRepository;
    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository;
    private final PavementMarkingLogsRepository pavementMarkingLogsRepository;
    private final XmlLayerVersionRepository xmlLayerVersionRepository;
    private final XmlLayerLogRepository xmlLayerLogRepository;
    private final VehicleRouteRepository vehicleRouteRepository;
    private final VehicleDataReader vehicleDataReader;

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
            return ResponseEntity.ok(unwrapNetwork(result));
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }
            throw e;
        }
    }

    /**
     * BBox 타일링 조회 (단계 1, 읽기 전용) — viewport 와 교차하는 부분집합만 반환.
     * 기존 {@code GET /{versionId}} 와 병존하며, 전국 규모에서 클라이언트 메모리를 viewport 로 제한한다.
     *
     * @param bbox "west,south,east,north" (WGS84 경위도)
     * @param lod overview|mid|near|detail (기본 detail)
     */
    @GetMapping("/{versionId}/tiles")
    public ResponseEntity<NetworkResponse> getNetworkTiles(
            @PathVariable String versionId,
            @RequestParam String bbox,
            @RequestParam(defaultValue = "detail") String lod) {
        try {
            String[] p = bbox.split(",");
            if (p.length != 4) return ResponseEntity.badRequest().build();
            double west  = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east  = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            NetworkTileService.Lod lodEnum;
            try {
                lodEnum = NetworkTileService.Lod.valueOf(lod.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                lodEnum = NetworkTileService.Lod.DETAIL;
            }

            NetworkResponse result = networkTileService.queryByBbox(versionId, west, south, east, north, lodEnum);
            // no-store: 재임포트 후 브라우저 캐시의 이전 네트워크 타일 재사용 방지 (tiles.mvt 와 동일)
            return ResponseEntity.ok()
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .body(result);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().build();
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[NetworkController] 타일 조회 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 네트워크 전체 bbox — 타일 모드에서 카메라를 네트워크 위치로 이동시키는 용도.
     * 응답: { west, south, east, north }. 네트워크 없으면 404.
     */
    @GetMapping("/{versionId}/extent")
    public ResponseEntity<java.util.Map<String, Double>> getNetworkExtent(@PathVariable String versionId) {
        try {
            double[] e = networkTileService.getExtent(versionId);
            if (e == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            return ResponseEntity.ok(java.util.Map.of("west", e[0], "south", e[1], "east", e[2], "north", e[3]));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[NetworkController] extent 조회 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * MVT(PBF) 타일 (단계 3) — overview/mid 2D 읽기 가속. z/x/y 웹 메르카토르 슬리피 타일.
     * 빈 타일은 204 No Content.
     */
    @GetMapping(value = "/{versionId}/tiles.mvt", produces = "application/x-protobuf")
    public ResponseEntity<byte[]> getNetworkMvt(
            @PathVariable String versionId,
            @RequestParam int z,
            @RequestParam int x,
            @RequestParam int y,
            @RequestParam(defaultValue = "overview") String lod) {
        try {
            NetworkTileService.Lod lodEnum;
            try {
                lodEnum = NetworkTileService.Lod.valueOf(lod.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                lodEnum = NetworkTileService.Lod.OVERVIEW;
            }
            byte[] mvt = networkTileService.queryMvt(versionId, z, x, y, lodEnum);
            if (mvt.length == 0) return ResponseEntity.noContent().build();
            // no-store: 네트워크 재임포트 후에도 브라우저 HTTP 캐시의 이전 타일이
            // 재사용되어 "새로고침해도 옛 네트워크가 보이는" 문제 방지 (OL 이 세션 내 캐시 담당)
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_TYPE, "application/x-protobuf")
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .body(mvt);
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[NetworkController] MVT 타일 오류 versionId={} z={} x={} y={}", versionId, z, x, y, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 도메인 id 기반 부분 저장 (단계 4-1) — 변경분(upsert/delete)만 받아 적용·저장.
     * 기존 전체 저장 {@code POST /{versionId}} 와 병존. 전국 규모에서 저장 payload 를 변경분으로 축소.
     */
    @PostMapping("/{versionId}/diff")
    public ResponseEntity<Map<String, Object>> saveNetworkDiff(
            @PathVariable String versionId,
            @RequestBody NetworkDiffRequest request) {
        log.info("[NetworkController] POST diff versionId={} upsertL={} delL={} upsertN={} delN={}",
                versionId, request.getUpsertLinks().size(), request.getDeleteLinkIds().size(),
                request.getUpsertNodes().size(), request.getDeleteNodeIds().size());
        try {
            // 1) 전체 네트워크에 diff 적용 → 갱신된 NetworkResponse.
            //    "새 버전으로 저장"이면 대상(versionId)에 network.xml 이 아직 없으므로
            //    baseVersionId(편집 중이던 기준 버전)에서 로드해 적용한다.
            String loadFrom = (request.getBaseVersionId() != null && !request.getBaseVersionId().isBlank())
                    ? request.getBaseVersionId() : versionId;

            // 대규모 네트워크(기본 100MB+): 전체 객체화가 힙을 초과(수도권 364MB 실측)하므로
            // 스트리밍 diff 로 network.xml 만 갱신하고 DB jsonb 레이어는 stale 행 삭제로
            // 파일 폴백을 보장한다 (getLatest 가 DB 없으면 XML 을 읽음).
            byte[] baseXml = fileStorage.readFile(loadFrom + "/network.xml");
            if (networkStreamingDiffService.isLarge(baseXml.length)) {
                log.info("[NetworkController] 대규모 네트워크({}MB) — 스트리밍 diff 적용", baseXml.length / (1024 * 1024));
                // 대규모 네트워크는 NetworkXml 로 전체 객체화가 불가(힙 초과, 실측)해 1c~1e 의
                // 소규모 경로(ID 대역 보정·댕글링 참조 삭제)는 여기서 그대로 재사용할 수 없다.
                // 다만 이 세션에서 확정된 크래시 원인(커넥션 미허용 회전으로 도달 불가능한 OD 수요)만은
                // network.xml 을 정규식 스트림 스캔해 동일하게 걸러낸다 — NextSimRunner 실행 시점
                // 재검증(2차 방어)이 이미 규모 무관하게 이 클래스의 크래시를 막고 있으므로, 여기서는
                // "저장 즉시 피드백"을 그리드/드로우 편집 양쪽에 동일하게 주기 위한 보강이다.
                int[] unreachableRemovedLarge = {0};
                networkStreamingDiffService.applyDiffStreaming(baseXml, versionId,
                        request.getUpsertLinks(), request.getUpsertNodes(),
                        request.getDeleteLinkIds(), request.getDeleteNodeIds(),
                        tmpNetworkXmlPath -> {
                            try {
                                OdMatrixXml currentOd = odMatrixService.getByVersionId(versionId);
                                int removed = networkReachabilityService.filterUnreachableDemands(currentOd, tmpNetworkXmlPath);
                                if (removed > 0) {
                                    odMatrixService.saveByVersionId(versionId, currentOd);
                                    xmlLayerVersionService.save("od_matrix", versionId,
                                            XmlLayerConverter.toMap(currentOd), new com.iitp.iitp_rest.model.LogsData());
                                    unreachableRemovedLarge[0] = removed;
                                }
                            } catch (Exception odErr) {
                                log.warn("[NetworkController] 대규모 네트워크 OD 도달가능성 재검증 실패(무시): {}", odErr.getMessage());
                            }
                        });
                xmlLayerVersionService.deleteVersion(LAYER_KEY, versionId); // stale jsonb → 파일 폴백
                networkTileService.invalidate(versionId);
                return ResponseEntity.ok(Map.of("linkIdRemap", Map.of(), "nodeIdRemap", Map.of(),
                        "odNodeIdRemap", Map.of(), "odPrunedDemandCount", unreachableRemovedLarge[0]));
            }

            NetworkResponse merged = networkTileService.applyDiff(
                    loadFrom,
                    request.getUpsertLinks(), request.getUpsertNodes(),
                    request.getDeleteLinkIds(), request.getDeleteNodeIds());

            // 1b) 수동 편집(지도 드로우)이 붙인 id는 Network ID naming 스펙과 무관한 프론트
            // 임시값(Date.now())이라, 형식 자체가 안 맞는 신규 노드/링크만 여기서 채번한다.
            // 이미 규칙에 맞는 기존 노드는 이번 편집으로 degree가 바뀌어도 여기서는 절대
            // 재채번하지 않는다 — odmatrix.xml/signal.xml 등 다른 레이어가 이미 그 id를
            // 참조하고 있을 수 있어서다(아래 1c 참고).
            NetworkIdNormalizer.NormalizeResult normalized = networkIdNormalizer.normalize(merged);
            merged = normalized.network();

            // 2) 기존 저장 경로 재사용 (DB 저장 + network.xml 파일 동기화 + 타일 캐시 무효화)
            Map<String, Object> cleanData = XmlLayerConverter.toMap(merged);
            xmlLayerVersionService.save(LAYER_KEY, versionId, cleanData, new com.iitp.iitp_rest.model.LogsData());
            networkTileService.invalidate(versionId);

            Map<String, String> odBandRemap = Map.of();
            int prunedOdDemandCount = 0;
            try {
                NetworkXml networkXml = networkMapper.fromResponse(merged);

                // 1c) OD 매트릭스가 이미 source/sink로 참조 중인 노드가 이번 네트워크 편집으로
                // degree 드리프트를 일으켜 id 대역(터미널 11xxxxxx/일반 10xxxxxx)이 실제와 안
                // 맞게 됐다면 보정한다 — NextSim route-generator가 이 대역 불일치로 실제 크래시
                // 함이 확인돼 있고(OdTerminalIdBandService 참고), prune-unused-terminals 설계상
                // 크래시 유발 경로는 OD 참조 노드로 좁혀지므로 그 외 노드는 건드리지 않는다.
                odBandRemap = odTerminalIdBandService.reconcileAfterNetworkEdit(versionId, networkXml);

                // 1d) 이번 편집으로 노드가 아예 삭제됐다면(대역 재배정과 달리 대상 노드 자체가
                // 없어 재배정이 불가능) OD가 그 노드를 참조하던 demand 항목 자체를 제거한다 —
                // 안 하면 존재하지 않는 노드를 가리키는 무효 참조가 odmatrix.xml에 그대로 남는다.
                //
                // 1e) 노드 자체는 남아있어도 이번 편집(커넥션/링크 삭제 등)으로 기존 OD 수요가
                // 더 이상 실제로 도달 불가능해질 수 있다 — 실측(gdb, 근본원인 확정): 링크가
                // 인접해 있어도 경로상 교차로에 그 회전을 허용하는 connection 이 없으면
                // route-generator 가 경로를 못 찾고 nextsim 이 크래시한다. pruneDanglingReferences
                // 는 "노드가 없어짐"만 잡고 "노드는 있지만 경로가 끊김"은 못 잡으므로 별도로 걸러야
                // 한다 — 그리드 편집(커넥션 삭제 등)과 지도 드로우 편집 모두 결국 이 diff 저장
                // 경로를 타므로, 여기서 걸러야 어느 편집 경로로 만든 변경이든 다 방어된다.
                try {
                    OdMatrixXml currentOd = odMatrixService.getByVersionId(versionId);
                    if (!odBandRemap.isEmpty()) odTerminalIdBandService.applyRemapToOdMatrix(currentOd, odBandRemap);
                    prunedOdDemandCount = odTerminalIdBandService.pruneDanglingReferences(networkXml, currentOd);
                    int unreachableRemoved = networkReachabilityService.filterUnreachableDemands(currentOd, networkXml);
                    prunedOdDemandCount += unreachableRemoved;
                    if (!odBandRemap.isEmpty() || prunedOdDemandCount > 0) {
                        odMatrixService.saveByVersionId(versionId, currentOd);
                        xmlLayerVersionService.save("od_matrix", versionId,
                                XmlLayerConverter.toMap(currentOd), new com.iitp.iitp_rest.model.LogsData());
                    }
                } catch (Exception odErr) {
                    log.warn("[NetworkController] OD 참조 정합성 반영 실패(무시): {}", odErr.getMessage());
                }

                byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
                fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
            } catch (Exception e) {
                log.warn("[NetworkController] diff 저장 network.xml 동기화 실패 (DB는 정상): {}", e.getMessage());
            }
            return ResponseEntity.ok(Map.of(
                    "linkIdRemap", normalized.linkIdRemap(),
                    "nodeIdRemap", normalized.nodeIdRemap(),
                    "odNodeIdRemap", odBandRemap,
                    "odPrunedDemandCount", prunedOdDemandCount));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[NetworkController] diff 저장 오류 versionId={}", versionId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
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

    /** DB 저장 + 로그 추가 + network.xml 파일 동기화 */
    @PostMapping("/{versionId}")
    public ResponseEntity<Void> saveNetwork(
            @PathVariable String versionId,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[NetworkController] POST versionId={}", versionId);
        try {
            Map<String, Object> cleanData = unwrapNetwork(request.getData());
            xmlLayerVersionService.save(LAYER_KEY, versionId, cleanData, request.getLogs());
            // 편집 저장 시 타일 캐시 무효화 → 다음 타일 요청에서 재빌드
            networkTileService.invalidate(versionId);
            // vehicle 시뮬레이션이 network.xml을 HTTP로 읽으므로 파일도 동기화
            try {
                NetworkResponse response = XmlLayerConverter.fromMap(cleanData, NetworkResponse.class);
                NetworkXml networkXml = networkMapper.fromResponse(response);
                byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
                fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
                log.info("[NetworkController] network.xml 파일 저장 완료: {}/network.xml", versionId);
            } catch (Exception e) {
                log.warn("[NetworkController] network.xml 파일 저장 실패 (DB는 정상 저장됨): {}", e.getMessage());
            }
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
            NetworkResponse response = com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter.fromMap(unwrapNetwork(data), NetworkResponse.class);
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

        // versionId 폴더에 저장 — 모든 읽기 경로(getNetworkXmlByVersionId: export/backup/타일 DB
        // 전체재빌드, OsmImportController/KtdbImportController 의 다른 두 네트워크 생성 경로)가
        // versionId 폴더만 읽고 상위 scenarioKey 폴더로 폴백하지 않는다. 예전엔 여기만 scenarioKey
        // (상위 시나리오 공유 폴더)에 썼던 탓에, 임포트가 그 순간엔 반영된 것처럼 보여도(같은 요청의
        // in-memory 응답을 타일 캐시에 바로 적재하므로) export/backup 은 즉시 낡은 데이터를 돌려주고,
        // 서버 재시작 등으로 타일 캐시가 파일에서 다시 빌드되면 방금 임포트한 내용이 통째로 사라졌다
        // (실측 재현: 재임포트 직후 /export·/backup 이 예전 값을 반환).
        String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
        log.info("SFTP 업로드 완료: {}/network.xml (versionId={})", versionId, versionId);
        // GET /network 은 DB(xml_layer_versions) 우선 — 옛 편집본 레코드를 지워야 새 XML이 반영된다
        // (scenarioKey 쪽도 과거에 거기 쓰던 시절의 낡은 DB 오버라이드가 남아있을 수 있어 함께 정리)
        xmlLayerVersionService.deleteVersion(LAYER_KEY, versionId);
        if (!scenarioKey.equals(versionId)) xmlLayerVersionService.deleteVersion(LAYER_KEY, scenarioKey);

        // 좌표를 파라미터로 받았다면 DB에 영구 저장 (이후 로드 시에도 동일 좌표 사용)
        if (latitude != null && longitude != null) {
            scenarioService.updateCoordinatesByKey(versionId, latitude, longitude);
            log.info("시나리오 기준 좌표 저장 완료: versionId={}, lat={}, lon={}", versionId, latitude, longitude);
        }

        NetworkResponse response = networkMapper.toResponse(networkXml);
        log.info("임포트 완료: 노드 {}개, 링크 {}개",
                response.getNodes() != null ? response.getNodes().size() : 0,
                response.getLinks() != null ? response.getLinks().size() : 0);

        // 타일 캐시 무효화 + 즉시 재빌드 (방금 만든 response 재사용 → network.xml 재다운로드/재파싱 없이).
        // 첫 타일 요청이 캐시 히트가 되어 "지도 반영 순간 멈춤"을 import 처리 시간에 흡수.
        try {
            networkTileService.invalidate(versionId);
            networkTileService.ingest(versionId, response);
        } catch (Exception e) {
            log.warn("[importNetworkXml] 타일 사전 빌드 실패 (첫 요청 시 lazy 빌드로 폴백): {}", e.getMessage());
        }

        return ResponseEntity.ok(new OsmSaveResponse(response, validation.warnings(), validation.errors()));
    }

    /**
     * 이미 임포트된 네트워크의 기준점(base_lat/base_lon)만 다시 잡는다 — 파일 재업로드 없이,
     * 로컬 shape/center 좌표는 그대로 두고 WGS84 좌표 전체를 새 기준점으로 재계산해 SFTP에
     * 재저장한다. /import(파일 재업로드) 와 같은 후처리(DB 캐시 무효화, 시나리오 좌표 동기화,
     * 타일 캐시 재빌드)를 그대로 따른다.
     */
    @PostMapping("/{versionId}/reanchor")
    public ResponseEntity<OsmSaveResponse> reanchorNetwork(
            @PathVariable String versionId,
            @RequestParam("latitude") double latitude,
            @RequestParam("longitude") double longitude
    ) {
        log.info("네트워크 기준점 재설정: versionId={}, lat={}, lon={}", versionId, latitude, longitude);
        try {
            NetworkXml networkXml = networkService.reanchor(versionId, latitude, longitude);

            OsmNetworkValidator.Result validation = validator.validate(networkXml);
            if (!validation.valid()) {
                log.warn("네트워크 검증 실패: {}", validation.errors());
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(new OsmSaveResponse(null, validation.warnings(), validation.errors()));
            }

            byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
            log.info("SFTP 업로드 완료: {}/network.xml (기준점 재설정, versionId={})", versionId, versionId);

            String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                    .map(v -> v.getScenario().getKey())
                    .orElse(versionId);
            xmlLayerVersionService.deleteVersion(LAYER_KEY, versionId);
            if (!scenarioKey.equals(versionId)) xmlLayerVersionService.deleteVersion(LAYER_KEY, scenarioKey);

            // 네트워크뿐 아니라 정류장/차량 시뮬레이션도 Scenario 좌표를 기준점으로 쓰므로 함께 갱신
            scenarioService.updateCoordinatesByKey(versionId, latitude, longitude);
            log.info("시나리오 기준 좌표 저장 완료: versionId={}, lat={}, lon={}", versionId, latitude, longitude);
            invalidateVehicleRouteCache(versionId);

            NetworkResponse response = networkMapper.toResponse(networkXml);

            try {
                networkTileService.invalidate(versionId);
                networkTileService.ingest(versionId, response);
            } catch (Exception e) {
                log.warn("[reanchorNetwork] 타일 사전 빌드 실패 (첫 요청 시 lazy 빌드로 폴백): {}", e.getMessage());
            }

            return ResponseEntity.ok(new OsmSaveResponse(response, validation.warnings(), validation.errors()));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[NetworkController] 기준점 재설정 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 2점 캘리브레이션 — 네트워크 상에 표시된 두 지점(src)이 실제로는 어디에 있어야 하는지(dst)
     * 지정하면 회전각·축척·기준점을 함께 역산해 적용한다. reanchor(위치만 이동)의 상위 호환.
     */
    @PostMapping("/{versionId}/calibrate")
    public ResponseEntity<OsmSaveResponse> calibrateNetwork(
            @PathVariable String versionId,
            @RequestParam double srcLat1, @RequestParam double srcLon1,
            @RequestParam double dstLat1, @RequestParam double dstLon1,
            @RequestParam double srcLat2, @RequestParam double srcLon2,
            @RequestParam double dstLat2, @RequestParam double dstLon2
    ) {
        log.info("네트워크 2점 캘리브레이션: versionId={}, p1=({},{})->({},{}), p2=({},{})->({},{})",
                versionId, srcLat1, srcLon1, dstLat1, dstLon1, srcLat2, srcLon2, dstLat2, dstLon2);
        try {
            NetworkXml networkXml = networkService.calibrate(
                    versionId, srcLat1, srcLon1, dstLat1, dstLon1, srcLat2, srcLon2, dstLat2, dstLon2);

            OsmNetworkValidator.Result validation = validator.validate(networkXml);
            if (!validation.valid()) {
                log.warn("네트워크 검증 실패: {}", validation.errors());
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(new OsmSaveResponse(null, validation.warnings(), validation.errors()));
            }

            byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
            log.info("SFTP 업로드 완료: {}/network.xml (캘리브레이션, versionId={})", versionId, versionId);

            String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                    .map(v -> v.getScenario().getKey())
                    .orElse(versionId);
            xmlLayerVersionService.deleteVersion(LAYER_KEY, versionId);
            if (!scenarioKey.equals(versionId)) xmlLayerVersionService.deleteVersion(LAYER_KEY, scenarioKey);

            // Scenario.latitude/longitude/baseRotation/baseScale 도 새 기준점으로 동기화 —
            // 차량 시뮬레이션(CoordinateConverter)이 network.xml이 아니라 이 Scenario 값을
            // 기준점으로 쓰므로, 회전/축척까지 함께 넘기지 않으면 도로는 회전·확대됐는데
            // 차량만 이동(translation)만 반영돼 도로에서 어긋나 보이는 문제가 생긴다.
            scenarioService.updateCoordinatesByKey(
                    versionId, networkXml.getBaseLat(), networkXml.getBaseLon(),
                    networkXml.getBaseRotation(), networkXml.getBaseScale());
            invalidateVehicleRouteCache(versionId);

            NetworkResponse response = networkMapper.toResponse(networkXml);

            try {
                networkTileService.invalidate(versionId);
                networkTileService.ingest(versionId, response);
            } catch (Exception e) {
                log.warn("[calibrateNetwork] 타일 사전 빌드 실패 (첫 요청 시 lazy 빌드로 폴백): {}", e.getMessage());
            }

            return ResponseEntity.ok(new OsmSaveResponse(response, validation.warnings(), validation.errors()));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(new OsmSaveResponse(null, List.of(), List.of(e.getMessage())));
        } catch (Exception e) {
            log.error("[NetworkController] 캘리브레이션 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 기준점 재설정(reanchor/calibrate) 후 차량 시뮬레이션이 이전 위치에 남아있지 않도록
     * 관련 캐시를 모두 지운다 — VehicleController가 차량 좌표를 매 요청마다 재계산하지 않고
     * "완성된 WGS84 좌표가 이미 포함된 CZML/positions"를 DB(vehicle_routes)와
     * VehicleDataReader의 SQLite 커넥션 캐시에 재사용하기 때문에, Scenario 좌표만 갱신해서는
     * 다음 재생 요청도 여전히 예전 위치로 계산된 캐시를 그대로 돌려준다.
     * vehicleDataReader.invalidateDbCache()는 등록된 리스너를 통해 VehicleController의
     * viewportCtxCache(스트리밍용 인메모리 캐시)도 함께 비운다.
     */
    private void invalidateVehicleRouteCache(String versionId) {
        vehicleRouteRepository.deleteByVersionId(versionId);
        vehicleDataReader.invalidateDbCache(versionId);
    }

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    /**
     * 네트워크 교체 전 종속 데이터를 ZIP으로 다운로드.
     * - signal.xml / vehicle_sim.db : SFTP에서 읽어 원본 형식으로 포함
     * - 나머지 레이어 JSON : 요청 바디(storeData)에서 가져와 {key}.json 으로 포함
     */
    @PostMapping("/{versionId}/dependent/zip")
    public ResponseEntity<byte[]> downloadDependentZip(
            @PathVariable String versionId,
            @RequestBody Map<String, Object> storeData) {
        log.info("[NetworkController] ZIP 백업 요청 versionId={}, 레이어수={}", versionId, storeData.size());
        try (ByteArrayOutputStream bos = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(bos)) {

            // SFTP 파일: 원본 형식 그대로 포함 (network.xml 포함)
            for (String filename : List.of("network.xml", "signal.xml", "vehicle_sim.db")) {
                try {
                    byte[] data = fileStorage.readFile(versionId + "/" + filename);
                    zip.putNextEntry(new ZipEntry(filename));
                    zip.write(data);
                    zip.closeEntry();
                    log.info("[ZIP] {} 포함", filename);
                } catch (Exception e) {
                    log.info("[ZIP] {} 없음(무시): {}", filename, e.getMessage());
                }
            }

            // 스토어 JSON 레이어: {key}.json 으로 포함
            for (Map.Entry<String, Object> entry : storeData.entrySet()) {
                String key = entry.getKey();
                Object data = entry.getValue();
                if (data == null) continue;
                try {
                    byte[] json = JSON_MAPPER.writeValueAsBytes(
                            Map.of("__iitp_layer", key, "data", data));
                    zip.putNextEntry(new ZipEntry(key + ".json"));
                    zip.write(json);
                    zip.closeEntry();
                } catch (Exception e) {
                    log.warn("[ZIP] {} JSON 직렬화 실패(무시): {}", key, e.getMessage());
                }
            }

            zip.finish();
            byte[] zipBytes = bos.toByteArray();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType("application/zip"));
            headers.setContentDispositionFormData("attachment", "backup_" + versionId + ".zip");
            headers.setContentLength(zipBytes.length);
            return ResponseEntity.ok().headers(headers).body(zipBytes);
        } catch (Exception e) {
            log.error("[NetworkController] ZIP 생성 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private static final List<String> DEPENDENT_XML_LAYER_KEYS = List.of(
            "signal_tod", "bus_pt_line", "bus_pt_line_weekday", "bus_pt_line_weekend",
            "rail_pt_line", "simulation_scenario"
    );

    /** 네트워크 교체 시 종속 레이어(신호, 정류장, 노면표시, 노선 등) 서버 데이터 전체 삭제 */
    @Transactional
    @DeleteMapping("/{versionId}/dependent")
    public ResponseEntity<Void> deleteDependentData(@PathVariable String versionId) {
        log.info("[NetworkController] DELETE dependent versionId={}", versionId);

        // vehicle_sim.db SFTP 삭제 (실패해도 계속 진행)
        // ⚠️ signal.xml 은 여기서 지우지 않는다 — KTDB/OSM 재임포트는 이 delete-dependent 호출과
        // 별개로 NextSimInputScaffolder.scaffoldForImport 를 비동기(CompletableFuture.runAsync)로
        // 백그라운드 실행해 signal.xml/signalTOD.xml 을 함께(backup-then-write) 재생성한다.
        // 예전엔 여기서도 signal.xml 을 명시적으로 삭제했는데, 프론트의 "지도에 반영" 확인
        // 흐름(백업 ZIP 다운로드 확인창 등)이 사용자 응답 속도에 따라 스캐폴딩보다 늦게 끝날 수
        // 있어 — 스캐폴딩이 signal.xml/TOD 를 정확히 일치하게 다 써놓은 "직후"에 이 delete 가
        // 뒤늦게 실행되며 방금 만든 정상 파일을 통째로 지워버리는 레이스가 실측 확인됐다(파일을
        // 폴링해 스캐폴딩 완료 2.5초 뒤 signal.xml 이 사라지는 것을 직접 관측). 그 이후로는 이
        // 임포트용 스캐폴딩이 다시 돌지 않아 파일이 영구히 사라진 채로 남았다. scaffoldForImport
        // 자체가 이미 낡은 파일을 감지해 안전하게 백업 후 재생성하므로, 별도의 경쟁하는 삭제
        // 경로는 불필요하고 위험하다 — signal.xml 은 scaffoldForImport 가 유일한 관리 주체가 된다.
        try {
            fileStorage.deleteFile(versionId + "/vehicle_sim.db");
            log.info("[NetworkController] SFTP 삭제: {}/vehicle_sim.db", versionId);
        } catch (Exception e) {
            log.warn("[NetworkController] SFTP 삭제 실패(무시): {}/vehicle_sim.db — {}", versionId, e.getMessage());
        }

        // XmlLayer 기반 종속 레이어 버전/로그 삭제
        for (String layerKey : DEPENDENT_XML_LAYER_KEYS) {
            xmlLayerLogRepository.deleteByLayerKeyAndVersionId(layerKey, versionId);
            xmlLayerVersionRepository.deleteByLayerKeyAndVersionId(layerKey, versionId);
        }

        // signal 버전/로그
        signalLogsRepository.deleteByVersionId(versionId);
        signalVersionsRepository.deleteByVersionId(versionId);

        // busStation 버전/로그
        busStationLogsRepository.deleteByVersionId(versionId);
        busStationVersionsRepository.deleteByVersionId(versionId);

        // railStation 버전/로그
        railStationLogsRepository.deleteByVersionId(versionId);
        railStationVersionsRepository.deleteByVersionId(versionId);

        // pavementMarking 버전/로그
        pavementMarkingLogsRepository.deleteByVersionId(versionId);
        pavementMarkingVersionsRepository.deleteByVersionId(versionId);

        // vehicle route (DB 캐시)
        vehicleRouteRepository.deleteByVersionId(versionId);

        log.info("[NetworkController] 종속 데이터 삭제 완료 versionId={}", versionId);
        return ResponseEntity.ok().build();
    }

    /** OsmSaveResponse 직렬화로 인해 붙는 "network" 래퍼 키를 제거한다. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> unwrapNetwork(Map<String, Object> data) {
        if (data != null && data.containsKey("network") && data.get("network") instanceof Map<?, ?> inner) {
            return (Map<String, Object>) inner;
        }
        return data;
    }
}
