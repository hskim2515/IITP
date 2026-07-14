package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkDiffRequest;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
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
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.service.network.OsmNetworkValidator;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import com.iitp.iitp_rest.util.FileStorageService;
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
    public ResponseEntity<Void> saveNetworkDiff(
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
            NetworkResponse merged = networkTileService.applyDiff(
                    loadFrom,
                    request.getUpsertLinks(), request.getUpsertNodes(),
                    request.getDeleteLinkIds(), request.getDeleteNodeIds());

            // 2) 기존 저장 경로 재사용 (DB 저장 + network.xml 파일 동기화 + 타일 캐시 무효화)
            Map<String, Object> cleanData = XmlLayerConverter.toMap(merged);
            xmlLayerVersionService.save(LAYER_KEY, versionId, cleanData, new com.iitp.iitp_rest.model.LogsData());
            networkTileService.invalidate(versionId);
            try {
                NetworkXml networkXml = networkMapper.fromResponse(merged);
                byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
                fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
            } catch (Exception e) {
                log.warn("[NetworkController] diff 저장 network.xml 동기화 실패 (DB는 정상): {}", e.getMessage());
            }
            return ResponseEntity.ok().build();
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

        String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "network.xml");
        log.info("SFTP 업로드 완료: {}/network.xml (scenarioKey={}, versionId={})", scenarioKey, scenarioKey, versionId);
        // GET /network 은 DB(xml_layer_versions) 우선 — 옛 편집본 레코드를 지워야 새 XML이 반영된다
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

        // signal.xml / vehicle_sim.db SFTP 삭제 (실패해도 계속 진행)
        for (String sfptPath : List.of(versionId + "/signal.xml", versionId + "/vehicle_sim.db")) {
            try {
                fileStorage.deleteFile(sfptPath);
                log.info("[NetworkController] SFTP 삭제: {}", sfptPath);
            } catch (Exception e) {
                log.warn("[NetworkController] SFTP 삭제 실패(무시): {} — {}", sfptPath, e.getMessage());
            }
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
