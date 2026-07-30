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
import com.iitp.iitp_rest.util.PolygonBoundaryUtils;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

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
    private final com.iitp.iitp_rest.service.vehicle.DummySignalGenerator dummySignalGenerator;
    // KTDB(표준노드링크)는 도로 geometry 전용이라 버스/철도 정류장·노선 데이터가 아예 없다 —
    // OSM(Overpass)에서 같은 bbox로 시설물만 별도로 가져와 KTDB 도로망에 스냅한다(OSM/SUMO
    // 임포트가 이미 쓰는 것과 동일한 OsmFacilityConverter — 링크 id 네임스페이스만 KTDB 것으로
    // 스냅되므로 그대로 재사용 가능). 실측: 이게 없어서 "KTDB 임포트하면 버스/철도 데이터가
    // 아예 안 생긴다"는 문제가 있었음.
    private final com.iitp.iitp_rest.service.network.OsmOverpassService overpassService;
    private final com.iitp.iitp_rest.service.network.OsmFacilityConverter facilityConverter;
    // 자동생성 토글이 꺼져 OSM에서 새로 안 가져온 경우(또는 대형망 스트리밍 경로처럼 애초에
    // OSM 조회가 없는 경우) — 검증만 하고 방치하지 않고, 이미 저장된 정류장/역의 link_ref/
    // lane_ref를 새 네트워크에 자동 재스냅한다(resnapExistingStationsIfNeeded 참고).
    private final com.iitp.iitp_rest.service.publicTransit.station.BusStationService busStationService;
    private final com.iitp.iitp_rest.service.publicTransit.station.RailStationService railStationService;

    // ── 백그라운드 스캐폴딩(더미 신호/OD/TOD 생성 + 타일 빌드) 진행 상태 ────────────
    // KTDB 저장 응답은 이 백그라운드 작업(CompletableFuture.runAsync)을 기다리지 않고 먼저
    // 돌아간다 — 대형망은 이 작업만 수십 초~수 분 걸릴 수 있는데, 프론트가 이를 알 방법이
    // 없어 "가져오기 완료"로 보이는 시점과 실제 더미 데이터가 준비되는 시점이 어긋났다
    // (사용자 실측: "아무리 기다려도 안 생기네"). 버전별로 진행 중 여부만 추적해 폴링용
    // 상태 엔드포인트로 노출한다 — try/finally 로 예외가 나도 반드시 해제되어 영구 stuck 방지.
    private static final Set<String> scaffoldInProgress = ConcurrentHashMap.newKeySet();
    // versionId → 완료 후 남긴 경고(버스/철도 노선이 새 네트워크와 안 맞음 등). 다음 상태
    // 조회 시 한 번 소비되고 지워진다(같은 경고가 폴링마다 반복 표시되지 않도록).
    private static final java.util.Map<String, String> scaffoldWarnings = new ConcurrentHashMap<>();

    @Operation(summary = "KTDB 가져오기 백그라운드 스캐폴딩(더미 신호/OD/TOD 생성 + 타일 빌드) 진행 여부",
               description = "가져오기 응답은 이 작업을 기다리지 않으므로, 완료 여부를 프론트가 폴링으로 확인한다.")
    @GetMapping("/ktdb/status")
    public ResponseEntity<Map<String, Object>> getScaffoldStatus(
            @Parameter(description = "시나리오 버전 키") @RequestParam String versionId) {
        boolean inProgress = scaffoldInProgress.contains(versionId);
        String warning = inProgress ? null : scaffoldWarnings.remove(versionId);
        java.util.Map<String, Object> body = new java.util.HashMap<>();
        body.put("inProgress", inProgress);
        if (warning != null) body.put("warning", warning);
        return ResponseEntity.ok(body);
    }

    /** roadPTline*.xml/railPTLine.xml이 새 네트워크(링크/노드 id)와 안 맞으면 경고 메시지를,
     *  전부 유효하거나 노선 자체가 없으면 null을 반환. 읽기 실패는 무시(파일 없음 등 정상 케이스 포함). */
    private String checkStaleRoutes(String versionId, java.util.Set<String> allLinkIds, java.util.Set<String> allNodeIds) {
        java.util.List<String> staleFiles = new java.util.ArrayList<>();
        for (String fileName : java.util.List.of("roadPTline.xml", "roadPTline-weekday.xml", "roadPTline-weekend.xml")) {
            try {
                String key = versionId + "/" + fileName;
                if (!fileStorage.exists(key)) continue;
                String content = new String(fileStorage.readFile(key), java.nio.charset.StandardCharsets.UTF_8);
                if (!com.iitp.iitp_rest.service.publicTransit.line.PtLineValidation.busRouteValid(content, allLinkIds, allNodeIds)) {
                    staleFiles.add(fileName);
                }
            } catch (Exception e) {
                log.warn("[KTDB] {} 노선 검증 실패(무시): {}", fileName, e.getMessage());
            }
        }
        if (staleFiles.isEmpty()) return null;
        return "버스 노선(" + String.join(", ", staleFiles) + ")이 재임포트로 바뀐 링크/노드 id를 참조하고 있습니다 — "
                + "대중교통 메뉴에서 확인·재작성이 필요할 수 있습니다.";
    }

    /**
     * KTDB 재임포트 시 OSM에서 정류장/역을 새로 안 가져온 경우(자동생성 토글 꺼짐, OSM 재조회
     * 실패, 또는 대형망 스트리밍 경로처럼 애초에 OSM 조회가 없는 경우) — 기존엔 검증만 하고
     * 방치해 link_ref/lane_ref가 새 네트워크와 안 맞는 채로 남았다. 정류장/역 자체(id·이름·
     * 부가정보)는 그대로 두고, 이미 저장된 좌표(center/exit.coord)만 OsmFacilityConverter의
     * 스냅 로직으로 새 네트워크에 재매핑해 저장한다(OSM 노드 좌표 대신 저장된 좌표를 입력으로
     * 재사용하는 것만 다르고 스냅 알고리즘은 동일).
     *
     * @param fac 이번 임포트에서 OSM으로 새로 가져온 결과 — null이거나 해당 교통수단이
     *            비어있으면("자동생성 안 함") 그 교통수단만 재스냅 대상.
     */
    private void resnapExistingStationsIfNeeded(
            String versionId, java.util.List<com.iitp.iitp_rest.model.network.link.LinkXml> links,
            com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityResult fac) {
        boolean busFresh = fac != null && fac.busStations() != null && !fac.busStations().getBusStations().isEmpty();
        boolean railFresh = fac != null && fac.railStations() != null && !fac.railStations().getRailStations().isEmpty();
        if (busFresh && railFresh || links == null || links.isEmpty()) return;

        facilityConverter.prepareLinkIndex(links);

        if (!busFresh) {
            try {
                var existing = busStationService.getBusStationsByVersionId(versionId).getBusStations();
                if (existing != null && !existing.isEmpty()) {
                    int resnapped = 0, dropped = 0;
                    java.util.List<com.iitp.iitp_rest.model.publicTransit.bus.BusStationResponse> kept = new java.util.ArrayList<>();
                    for (var st : existing) {
                        var r = facilityConverter.resnapByLocalCoord(st.getCenter());
                        if (r == null) { dropped++; continue; } // NextSim이 link_ref를 필수 속성으로 요구 — 스냅 실패면 유지 불가
                        st.setLinkRef(r.linkId());
                        st.setLaneRef((long) r.laneId());
                        st.setOffset((double) r.offset());
                        kept.add(st);
                        resnapped++;
                    }
                    if (resnapped > 0 || dropped > 0) {
                        var req = new com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest();
                        req.setData(busStationService.toDataList(kept));
                        req.setLogs(new com.iitp.iitp_rest.model.LogsData());
                        busStationService.saveBusStationsByVersionId(req, versionId);
                        log.info("[KTDB] 버스정류장 재스냅: {}개 갱신, {}개 스냅실패로 제외", resnapped, dropped);
                    }
                }
            } catch (Exception e) {
                log.warn("[KTDB] 버스정류장 재스냅 실패(무시): {}", e.getMessage());
            }
        }

        if (!railFresh) {
            try {
                var existing = railStationService.getByVersionId(versionId).getData();
                if (existing != null && !existing.isEmpty()) {
                    int resnapped = 0, dropped = 0;
                    for (var st : existing) {
                        if (st.getExits() == null || st.getExits().isEmpty()) continue;
                        java.util.List<com.iitp.iitp_rest.model.publicTransit.rail.ExitData> keptExits = new java.util.ArrayList<>();
                        for (var exit : st.getExits()) {
                            var r = facilityConverter.resnapByLocalCoord(exit.getCoord());
                            if (r == null) { dropped++; continue; }
                            exit.setLinkRef((int) r.linkId());
                            exit.setOffset((double) r.offset());
                            keptExits.add(exit);
                            resnapped++;
                        }
                        st.setExits(keptExits);
                    }
                    if (resnapped > 0 || dropped > 0) {
                        var req = new com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest();
                        req.setData(existing);
                        req.setLogs(new com.iitp.iitp_rest.model.LogsData());
                        railStationService.saveRailStationByVersionId(req, versionId);
                        log.info("[KTDB] 철도역 출입구 재스냅: {}개 갱신, {}개 스냅실패로 제외", resnapped, dropped);
                    }
                }
            } catch (Exception e) {
                log.warn("[KTDB] 철도역 재스냅 실패(무시): {}", e.getMessage());
            }
        }
    }

    // ── 공통 변환 로직 ────────────────────────────────────────────────────────

    private record KtdbContext(NetworkXml networkXml, double originLat, double originLon) {}

    private KtdbContext build(
            double south, double west, double north, double east,
            int networkId, String versionId, String polygon) {

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

        List<List<double[]>> polygonRings = PolygonBoundaryUtils.parsePolygonParam(polygon);
        KtdbNetworkConverter.ConvertResult result = polygonRings.isEmpty()
                ? ktdbConverter.convert(south, west, north, east, originLat, originLon, networkId)
                : ktdbConverter.convert(south, west, north, east, originLat, originLon, networkId, polygonRings);

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
            @Parameter(description = "시나리오 버전 키 (SFTP 저장 경로)") @RequestParam(required = false) String versionId,
            @Parameter(description = "폴리곤/파일 경계 — [[[lon,lat],...],...] JSON, 여러 링이면 합집합")
            @RequestParam(required = false) String polygon,
            @Parameter(description = "OD 샘플 수요 최소 flow(대/h) — 앱 설정 자동생성 항목, 미지정 시 기본값")
            @RequestParam(required = false) Integer odMinFlow,
            @Parameter(description = "OD 샘플 수요 최대 flow(대/h) — 앱 설정 자동생성 항목, 미지정 시 기본값")
            @RequestParam(required = false) Integer odMaxFlow,
            @Parameter(description = "OD 거리 감쇠 기준 거리(m) — 앱 설정 자동생성 항목, 미지정 시 기본값")
            @RequestParam(required = false) Double odRefDistM,
            @Parameter(description = "버스 정류장/노선 자동생성 여부 — 앱 설정 자동생성 항목, 미지정 시 true")
            @RequestParam(required = false) Boolean generateBusFacilities,
            @Parameter(description = "철도역/노선 자동생성 여부 — 앱 설정 자동생성 항목, 미지정 시 true")
            @RequestParam(required = false) Boolean generateRailFacilities,
            @Parameter(description = "버스 노선 기본 배차간격(분) — 앱 설정 자동생성 항목, 미지정 시 기본값")
            @RequestParam(required = false) Integer busDefaultIntervalMin
    ) {
        log.info("KTDB Save: bbox=({},{},{},{}), versionId={}", south, west, north, east, versionId);
        NextSimInputScaffolder.OdGenerationParams odParams =
                new NextSimInputScaffolder.OdGenerationParams(odMinFlow, odMaxFlow, odRefDistM);
        com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityGenerationOptions facilityOptions =
                new com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityGenerationOptions(
                        generateBusFacilities, generateRailFacilities, busDefaultIntervalMin);
        boolean isLarge = KtdbStreamingConverter.LARGE_BBOX_THRESHOLD <
                          (north - south) * (east - west);

        if (isLarge) {
            // 대형 bbox 스트리밍 경로(KtdbStreamingConverter)는 타일 단위로 클러스터 상태를
            // 점증적으로 쌓는 구조라 나중에 링크 목록만 후필터링하면 소속/차수 정보가 어긋난다
            // — 안전하게 지원하려면 타일 처리 로직 자체를 고쳐야 해서 정밀 클리핑은 이번 범위에서
            // 제외했다. ⚠️ 예전엔 여기서 422로 완전히 막았는데, KTDB 탭은 폴리곤 그리기/파일
            // 업로드가 아니면 bbox를 아예 못 정하는 구조(남/서/북/동 입력이 readOnly)라 —
            // "사각형으로 넓게 그려도 무조건 폴리곤이 잡혀 전송"되면서 넓은 지역 KTDB 임포트 자체가
            // 완전히 막혀버리는 회귀였다(사용자 보고: "이전에는 더 넓게도 가져왔잖아"). 정밀 경계
            // 클리핑 대신 폴리곤의 bbox(포함 사각형) 전체를 그대로 가져오고, 경계가 근사됐음을
            // 경고로 알린다 — 예전에 "사각형 그리기"로 되던 동작과 동일한 결과.
            List<String> extraWarnings = (polygon != null && !polygon.isBlank())
                    ? List.of("영역이 너무 넓어(약 33km² 초과) 그리신 경계의 정확한 모양은 적용되지 않고, "
                            + "경계를 포함하는 사각형(bbox) 전체를 가져왔습니다.")
                    : List.of();
            return handleLargeBbox(south, west, north, east, networkId, versionId, extraWarnings, odParams);
        }

        try {
            KtdbContext ctx = build(south, west, north, east, networkId, versionId, polygon);
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

            // 버스/철도 정류장·노선 — OSM에서 같은 bbox로 조회해 방금 만든 KTDB 도로망에 스냅
            // (실패해도 네트워크 임포트 자체는 계속 성공해야 하므로 별도로 감싼다)
            com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityResult fac = null;
            try {
                var facilityRaw = overpassService.queryFacilities(south, west, north, east);
                fac = facilityConverter.convert(facilityRaw, networkXml, ctx.originLat(), ctx.originLon(),
                        new double[]{south, west, north, east}, facilityOptions);
                log.info("KTDB 시설물(OSM 스냅): 버스정류장 {}개, 철도역 {}개, 버스노선 {}개, 철도노선 {}개",
                        fac.busStations() != null ? fac.busStations().getBusStations().size() : 0,
                        fac.railStations() != null ? fac.railStations().getRailStations().size() : 0,
                        fac.busRoutes() != null ? ((List<?>) fac.busRoutes().get("lines")).size() : 0,
                        fac.railRoutes() != null ? ((List<?>) fac.railRoutes().get("routes")).size() : 0);
            } catch (Exception e) {
                log.warn("[KTDB] OSM 시설물 조회/변환 실패(무시 — 네트워크 임포트는 계속 진행): {}", e.getMessage());
            }

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
                final java.util.Set<String> allLinkIds = networkXml.getLinks() == null ? java.util.Set.of()
                        : networkXml.getLinks().stream()
                            .map(com.iitp.iitp_rest.model.network.link.LinkXml::getId)
                            .filter(java.util.Objects::nonNull)
                            .map(String::valueOf)
                            .collect(java.util.stream.Collectors.toSet());
                final com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityResult finalFac = fac;
                scaffoldInProgress.add(vid);
                CompletableFuture.runAsync(() -> {
                    try {
                        nextSimScaffolder.scaffoldForImport(vid, allNodeIds, finalSourceIds, finalSinkIds,
                                finalTerminalCoords, finalNetworkXml, null, odParams);
                        try { networkTileService.ingest(vid, resp); }
                        catch (Exception e) { log.warn("[KTDB] 타일 DB 선빌드 실패 (무시): {}", e.getMessage()); }
                        resnapExistingStationsIfNeeded(vid, finalNetworkXml.getLinks(), finalFac);
                        String warning = checkStaleRoutes(vid, allLinkIds, allNodeIds);
                        if (warning != null) scaffoldWarnings.put(vid, warning);
                    } finally {
                        scaffoldInProgress.remove(vid);
                    }
                });
            }

            return ResponseEntity.ok(new OsmSaveResponse(
                    networkResponse, validation.warnings(), List.of(), List.of(),
                    fac != null ? fac.busStations() : null,
                    fac != null ? fac.railStations() : null,
                    fac != null ? fac.busRoutes() : null,
                    fac != null ? fac.railRoutes() : null,
                    false));

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
            int networkId, String versionId, List<String> extraWarnings,
            NextSimInputScaffolder.OdGenerationParams odParams) {
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
                final java.util.Set<String> allLinkIds = sr.links().stream()
                        .map(l -> String.valueOf(l.getId()))
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
                scaffoldInProgress.add(vid);
                CompletableFuture.runAsync(() -> {
                    try {
                        // 대형 bbox는 전체 NetworkXml을 메모리에 안 올리므로(streamConvert 가 애초에
                        // 이걸 피하려고 스트리밍하는 것), 더미 신호도 같은 원칙으로 생성한다 — 이미
                        // SFTP에 저장된 network.xml을 <node> 블록 단위로만 스트림 통과하며 처리
                        // (DummySignalGenerator.generateSignalXmlStreaming, lanes/cells 포함한 전체
                        // 객체 그래프를 절대 메모리에 올리지 않음). 실패해도 빈 템플릿으로 안전 폴백.
                        String precomputedSignalXml = null;
                        String signalGenWarning = null;
                        try {
                            byte[] xmlBytes = fileStorage.readFile(vid + "/network.xml");
                            precomputedSignalXml = dummySignalGenerator.generateSignalXmlStreaming(xmlBytes);
                        } catch (Exception e) {
                            // ⚠️ 실측: 이 예외를 로그로만 남기고 조용히 폴백하면(예전 동작), 재임포트인
                            // 경우 "기존 signal.xml이 새 네트워크에도 여전히 유효"로 판정돼(참조 노드가
                            // 우연히 새 노드 집합에도 존재) 낡은 신호가 그대로 남고, 첫 임포트인 경우
                            // signal.xml이 완전히 빈 채로 생성된다 — 둘 다 사용자에게는 "신호 자동생성이
                            // 안 됐다"로만 보이고 원인을 알 방법이 없었다. checkStaleRoutes와 동일하게
                            // scaffoldWarnings에 남겨 프론트가 폴링 시 보여주게 한다.
                            log.warn("[KTDB] 대형망 스트리밍 신호 생성 실패 (기존/빈 신호로 폴백): {}", e.toString());
                            signalGenWarning = "신호 자동생성 실패 — 신호 메뉴에서 직접 생성하거나 다시 가져와 주세요 (" + e.getMessage() + ")";
                        }
                        // NextSim 필수 입력 정비 — 없으면 생성, 재임포트로 id 변경 시 재생성 (타일 빌드보다 먼저)
                        nextSimScaffolder.scaffoldForImport(vid, allNodeIds, sourceIds, sinkIds, terminalCoords,
                                null, precomputedSignalXml, odParams);
                        try { networkTileService.ingest(vid, resp); }   // 1차: simplified 빠른 빌드
                        catch (Exception e) { log.warn("[KTDB] 타일 DB 선빌드 실패 (무시): {}", e.getMessage()); }
                        // 2차: SFTP XML 기반 완전 재빌드 — 1차 실패와 무관하게 항상 시도 (내부 예외 처리)
                        networkTileService.rebuildFromXml(vid);
                        // 대형망 스트리밍 경로는 OSM 시설물 조회 자체가 없어(streamConvert가
                        // 도로 geometry만 다룸) 기존 정류장/역이 항상 재스냅 대상이다 — LinkResponse
                        // (id/fromNode/toNode/shape만 필요)를 스냅용 최소 LinkXml로 변환.
                        var linksForSnap = sr.links().stream().map(lr -> {
                            var lx = new com.iitp.iitp_rest.model.network.link.LinkXml();
                            lx.setId(lr.getId());
                            lx.setFromNode(lr.getFromNode());
                            lx.setToNode(lr.getToNode());
                            lx.setShape(lr.getShape());
                            return lx;
                        }).toList();
                        resnapExistingStationsIfNeeded(vid, linksForSnap, null);
                        String staleWarning = checkStaleRoutes(vid, allLinkIds, allNodeIds);
                        String warning = java.util.stream.Stream.of(signalGenWarning, staleWarning)
                                .filter(java.util.Objects::nonNull)
                                .reduce((a, b) -> a + " / " + b)
                                .orElse(null);
                        if (warning != null) scaffoldWarnings.put(vid, warning);
                    } finally {
                        scaffoldInProgress.remove(vid);
                    }
                });
            }

            List<String> combinedWarnings = new java.util.ArrayList<>(extraWarnings);
            combinedWarnings.addAll(sr.warnings());
            return ResponseEntity.ok(new OsmSaveResponse(
                    simplified, combinedWarnings, List.of(), List.of(), null, null, null, null, true));

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
            KtdbContext ctx = build(south, west, north, east, networkId, null, null);
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
            KtdbContext ctx = build(south, west, north, east, networkId, null, null);
            return ResponseEntity.ok(networkMapper.toResponse(ctx.networkXml()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).build();
        } catch (Exception e) {
            log.error("KTDB JSON 실패: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
