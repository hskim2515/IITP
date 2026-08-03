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
    // ⚠️ nextSimScaffolder.scaffoldForImport()가 signal.xml을 재생성(node id 불일치 등)할 때
    // SignalTileService를 거치지 않고 SFTP에 직접 쓴다 — 위 busStationTileService와 동일한
    // 이유로, 재임포트 후 신호 타일 캐시가 안 갱신되면 옛 신호가 계속 서빙된다.
    private final com.iitp.iitp_rest.service.signal.SignalTileService signalTileService;
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
    // ⚠️ 실측: BUS_STATION_TILING.ENABLED=true라 프론트는 정류장을 이 타일 캐시(SQLite)로
    // 받는데, 재임포트로 link_ref/lane_ref/medianLane이 갱신돼도 이 캐시를 무효화하지 않으면
    // 예전 스냅샷이 계속 서빙된다(2026-08-03 실사용 발견: laneRef/medianLane 수정이 재가져오기
    // 후에도 반영 안 됨 — "주황색만 보임"). resnap/재생성이 정류장을 저장하는 모든 지점에서
    // 반드시 invalidate 해야 한다.
    private final com.iitp.iitp_rest.service.publicTransit.station.BusStationTileService busStationTileService;
    // 철도역 재스냅(위 버스와 동일 이유)에도 같은 무효화 규칙이 적용된다.
    private final com.iitp.iitp_rest.service.publicTransit.station.RailStationTileService railStationTileService;
    private final com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper railStationMapper;
    // roadPTline*.xml 노선의 link/node seq 자동 재매핑(remapStaleBusRoutes) 용 — 철도 노선은
    // railStationSeq(정류장 id)만 참조하고 재임포트로도 안 바뀌는 안정적 네임스페이스라
    // 재매핑이 필요 없음(PtLineValidation.java 클래스 주석 참고).
    private final com.iitp.iitp_rest.service.publicTransit.line.BusPtLineService busPtLineService;

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
     * @param oldOriginLat/oldOriginLon 재임포트 "이전" 시나리오 버전 좌표(=기존 정류장 로컬
     *            좌표의 원점). 재임포트는 매번 원점을 bbox 중심으로 새로 잡으므로(build()가
     *            versionId로 Scenario를 못 찾아 좌표 재사용 분기를 안 탐), bbox가 바뀌면 저장된
     *            로컬 좌표가 통째로 어긋난다(실측: 좁은 bbox 재임포트에서 전 정류장이 ~700m
     *            벗어나 재스냅 전멸). 스냅 전에 옛→새 원점 평행이동을 적용하고, 저장 시 center/
     *            coord도 새 원점 기준으로 갱신해 데이터 일관성을 유지한다.
     */
    private void resnapExistingStationsIfNeeded(
            String versionId, java.util.List<com.iitp.iitp_rest.model.network.link.LinkXml> links,
            com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityResult fac,
            Double oldOriginLat, Double oldOriginLon, double newOriginLat, double newOriginLon) {
        boolean busFresh = fac != null && fac.busStations() != null && !fac.busStations().getBusStations().isEmpty();
        boolean railFresh = fac != null && fac.railStations() != null && !fac.railStations().getRailStations().isEmpty();
        if (busFresh && railFresh || links == null || links.isEmpty()) return;

        double[] shift = com.iitp.iitp_rest.service.network.OsmFacilityConverter.originShiftMeters(
                oldOriginLat, oldOriginLon, newOriginLat, newOriginLon);
        boolean shifted = shift[0] != 0.0 || shift[1] != 0.0;
        if (shifted) {
            log.info("[KTDB] {} 원점 이동 감지: ({}, {}) → ({}, {}) — 로컬좌표 평행이동 dx={}m dy={}m 적용",
                    versionId, oldOriginLat, oldOriginLon, newOriginLat, newOriginLon,
                    Math.round(shift[0]), Math.round(shift[1]));
        }

        if (!busFresh) {
            try {
                var existing = busStationService.getBusStationsByVersionId(versionId).getBusStations();
                if (existing != null && !existing.isEmpty()) {
                    int resnapped = 0, unsnapped = 0;
                    // ⚠️ prepareLinkIndex로 채운 인스턴스 상태(OsmFacilityConverter는 @Service
                    // 싱글턴)를 이 루프가 다 쓸 때까지 다른 스레드(예: 노선 그리기 완료
                    // compute-path)가 못 건드리게 락을 잡는다 — 개별 메서드 synchronized만으로는
                    // prepareLinkIndex→resnapByLocalCoord 반복 "시퀀스"가 원자적이지 않다
                    // (OsmFacilityConverter 클래스 상단 주석 참고, 2026-07-31 실사용 지적으로
                    // 발견). 아래 저장(SFTP/DB) 호출은 facilityConverter 상태와 무관하므로
                    // 느린 I/O를 락 밖에 두려고 일부러 이 블록 밖으로 뺐다.
                    synchronized (facilityConverter) {
                        facilityConverter.prepareLinkIndex(links);
                        for (var st : existing) {
                            // 원점이 바뀐 경우 스냅 성공 여부와 무관하게 center는 새 원점 기준으로
                            // 갱신해야 한다(순수 좌표계 변환 — 같은 물리적 위치). 일부만 갱신하면
                            // 한 데이터셋 안에 서로 다른 원점 기준 좌표가 섞이는 최악의 상태가 된다.
                            if (shifted) st.setCenter(com.iitp.iitp_rest.service.network.OsmFacilityConverter
                                    .shiftLocalCoord(st.getCenter(), shift[0], shift[1]));
                            var r = facilityConverter.resnapByLocalCoord(st.getCenter());
                            // 스냅 실패(50m 밖) 시 정류장 자체를 지우면 안 된다 — 이름/부가정보를 가진
                            // 실제 레코드가 좌표 문제 하나로 통째로 사라지는 게 훨씬 나쁜 결과다.
                            // 옛 link_ref를 그대로 두고 그대로 저장 — 여전히 낡았을 순 있지만
                            // checkStaleRoutes/수동 확인으로 드러나는 편이, 조용히 삭제되는 것보다 안전하다.
                            if (r == null) { unsnapped++; continue; }
                            st.setLinkRef(r.linkId());
                            st.setLaneRef((long) r.laneId());
                            st.setOffset((double) r.offset());
                            st.setMedianLane(r.medianLane() ? true : null);
                            resnapped++;
                        }
                    }
                    if (resnapped > 0 || (shifted && !existing.isEmpty())) {
                        var req = new com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest();
                        req.setData(busStationService.toDataList(existing));
                        req.setLogs(new com.iitp.iitp_rest.model.LogsData());
                        busStationService.saveBusStationsByVersionId(req, versionId);
                        try {
                            busStationTileService.invalidate(versionId);
                            busStationTileService.ingest(versionId, existing);
                        } catch (Exception e) {
                            log.warn("[KTDB] 버스정류장 타일 캐시 재빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
                        }
                        log.info("[KTDB] 버스정류장 재스냅: {}개 갱신, {}개 스냅실패(기존 값 유지)", resnapped, unsnapped);
                    } else if (unsnapped > 0) {
                        log.info("[KTDB] 버스정류장 재스냅 전부 실패({}개, 좌표가 새 네트워크에서 50m 밖) — 기존 값 유지", unsnapped);
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
                    int resnapped = 0, unsnapped = 0;
                    synchronized (facilityConverter) {
                        facilityConverter.prepareLinkIndex(links);
                        for (var st : existing) {
                            if (shifted) st.setCenter(com.iitp.iitp_rest.service.network.OsmFacilityConverter
                                    .shiftLocalCoord(st.getCenter(), shift[0], shift[1]));
                            if (st.getExits() == null || st.getExits().isEmpty()) continue;
                            for (var exit : st.getExits()) {
                                if (shifted) exit.setCoord(com.iitp.iitp_rest.service.network.OsmFacilityConverter
                                        .shiftLocalCoord(exit.getCoord(), shift[0], shift[1]));
                                var r = facilityConverter.resnapByLocalCoord(exit.getCoord());
                                // 스냅 실패해도 exit을 지우지 않고 옛 linkRef를 그대로 둔다 — 버스
                                // 정류장과 동일 원칙(조용한 삭제보다 낡은 채로 남는 게 안전).
                                if (r == null) { unsnapped++; continue; }
                                exit.setLinkRef((int) r.linkId());
                                exit.setOffset((double) r.offset());
                                resnapped++;
                            }
                        }
                    }
                    if (resnapped > 0 || (shifted && !existing.isEmpty())) {
                        var req = new com.iitp.iitp_rest.model.publicTransit.rail.RailStationSaveRequest();
                        req.setData(existing);
                        req.setLogs(new com.iitp.iitp_rest.model.LogsData());
                        railStationService.saveRailStationByVersionId(req, versionId);
                        try {
                            railStationTileService.invalidate(versionId);
                            var xml = railStationService.getRailStationXmlByVersionId(versionId);
                            var saved = railStationMapper.toResponse(xml);
                            railStationTileService.ingest(versionId,
                                    saved.getRailStations() != null ? saved.getRailStations() : List.of());
                        } catch (Exception e) {
                            log.warn("[KTDB] 철도역 타일 캐시 재빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
                        }
                        log.info("[KTDB] 철도역 출입구 재스냅: {}개 갱신, {}개 스냅실패(기존 값 유지)", resnapped, unsnapped);
                    } else if (unsnapped > 0) {
                        log.info("[KTDB] 철도역 출입구 재스냅 전부 실패({}개, 좌표가 새 네트워크에서 50m 밖) — 기존 값 유지", unsnapped);
                    }
                }
            } catch (Exception e) {
                log.warn("[KTDB] 철도역 재스냅 실패(무시): {}", e.getMessage());
            }
        }
    }

    /**
     * roadPTline*.xml의 기존 노선이 새 네트워크와 안 맞으면(link/node id가 재임포트로
     * 낡아짐) — resnapExistingStationsIfNeeded로 이미 새 네트워크에 재스냅된 정류장들의
     * linkRef를 waypoint 삼아 link/node seq를 자동으로 다시 만든다(정류장은 그대로 두고
     * 경로만 재구성 — {@link com.iitp.iitp_rest.service.network.OsmFacilityConverter#remapBusRouteByStationAnchors}).
     * 노선별로 독립 처리하므로 일부 노선이 재매핑 불가(위상이 크게 바뀜)여도 나머지는
     * 정상 갱신된다 — 반드시 resnapExistingStationsIfNeeded 이후에 호출해야 정류장 linkRef가
     * 최신 상태다. 정류장 정보가 아예 없는 버전은 조용히 건너뛴다(재매핑할 앵커가 없음).
     *
     * ⚠️ 이번 요청에서 OSM으로 노선을 새로 가져왔으면(busFacilityEnabled 켜짐, fac 이 신선함)
     * 절대 호출하면 안 된다 — 프론트가 이 백그라운드 작업과 별개로 곧 fresh 데이터를
     * injectAll+saveRoute로 저장할 예정인데, 그 사이 이 함수가 "옛(stale) 데이터 기준 재매핑
     * 결과"로 SFTP를 먼저 덮어써버리면 타이밍에 따라 fresh 저장을 되돌리는 회귀가 될 수 있다
     * — resnapExistingStationsIfNeeded와 동일한 fac 기준 게이팅을 호출부에서 먼저 적용한다.
     */
    private void remapStaleBusRoutes(String versionId, java.util.List<com.iitp.iitp_rest.model.network.link.LinkXml> links) {
        if (links == null || links.isEmpty()) return;
        java.util.Map<String, Long> stationLinkRefById;
        try {
            var stations = busStationService.getBusStationsByVersionId(versionId).getBusStations();
            if (stations == null || stations.isEmpty()) return;
            stationLinkRefById = new java.util.HashMap<>();
            for (var s : stations) {
                if (s.getId() != null && s.getLinkRef() != null) stationLinkRefById.put(s.getId(), s.getLinkRef());
            }
        } catch (Exception e) {
            log.warn("[KTDB] 노선 재매핑용 정류장 조회 실패(무시): {}", e.getMessage());
            return;
        }
        if (stationLinkRefById.isEmpty()) return;

        remapRouteFile(links, versionId, "roadPTline.xml", BusPtLineController.LAYER_KEY_DEFAULT, stationLinkRefById,
                busPtLineService::getDefault, busPtLineService::saveDefault);
        remapRouteFile(links, versionId, "roadPTline-weekday.xml", BusPtLineController.LAYER_KEY_WEEKDAY, stationLinkRefById,
                busPtLineService::getWeekday, busPtLineService::saveWeekday);
        remapRouteFile(links, versionId, "roadPTline-weekend.xml", BusPtLineController.LAYER_KEY_WEEKEND, stationLinkRefById,
                busPtLineService::getWeekend, busPtLineService::saveWeekend);
    }

    private interface RouteFetcher { com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml get(String versionId) throws java.io.IOException; }
    private interface RouteSaver { void save(String versionId, com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml data) throws Exception; }

    private void remapRouteFile(
            java.util.List<com.iitp.iitp_rest.model.network.link.LinkXml> links,
            String versionId, String fileName, String layerKey, java.util.Map<String, Long> stationLinkRefById,
            RouteFetcher fetcher, RouteSaver saver) {
        try {
            if (!fileStorage.exists(versionId + "/" + fileName)) return;
            var data = fetcher.get(versionId); // I/O(SFTP) — 락 밖
            if (data.getLines() == null || data.getLines().isEmpty()) return;
            int remapped = 0, failed = 0;
            // ⚠️ prepareLinkIndex로 채운 인스턴스 상태(OsmFacilityConverter는 @Service 싱글턴)를
            // 이 루프가 다 쓸 때까지 다른 스레드(예: 노선 그리기 완료 compute-path)가 못
            // 건드리게 락을 잡는다 — 개별 메서드 synchronized만으로는 prepareLinkIndex→
            // remapBusRouteByStationAnchors 반복 "시퀀스"가 원자적이지 않다(OsmFacilityConverter
            // 클래스 상단 주석 참고, 2026-07-31 실사용 지적으로 발견). fetch/save 같은 느린
            // SFTP I/O는 facilityConverter 상태와 무관하므로 일부러 이 블록 밖에 둔다 — 같은
            // links로 매번 다시 준비하는 게 다소 중복이지만 순수 메모리 연산이라 저렴하다.
            synchronized (facilityConverter) {
                facilityConverter.prepareLinkIndex(links);
                for (var line : data.getLines()) {
                    String stationSeqStr = line.getStation() != null ? line.getStation().getSeq() : null;
                    if (stationSeqStr == null || stationSeqStr.isBlank()) continue;
                    java.util.List<Long> anchors = new java.util.ArrayList<>();
                    for (String stId : stationSeqStr.trim().split("\\s+")) {
                        Long ref = stationLinkRefById.get(stId);
                        if (ref != null) anchors.add(ref);
                    }
                    var remap = facilityConverter.remapBusRouteByStationAnchors(anchors);
                    if (remap == null) { failed++; continue; }
                    if (line.getLink() == null) line.setLink(new com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml.SeqXml());
                    if (line.getNode() == null) line.setNode(new com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml.SeqXml());
                    line.getLink().setSeq(remap.linkSeq());
                    line.getNode().setSeq(remap.nodeSeq());
                    remapped++;
                }
            }
            if (remapped > 0) {
                saver.save(versionId, data);
                // saver.save()는 SFTP/로컬 파일만 갱신한다 — GET /public-transit/line/bus/*는
                // XmlLayerVersionService의 DB 캐시(getLatest)를 먼저 보므로, 이걸 지우지 않으면
                // 파일은 최신인데 API는 계속 재매핑 전 옛 데이터를 돌려주는 불일치가 생긴다
                // (network.xml 재임포트 시 xmlLayerVersionService.deleteVersion("network", ...)를
                // 부르는 것과 동일한 이유 — 실측으로 발견).
                xmlLayerVersionService.deleteVersion(layerKey, versionId);
                log.info("[KTDB] {} 노선 재매핑: {}개 갱신, {}개 실패(수동 재작업 필요)", fileName, remapped, failed);
            } else if (failed > 0) {
                log.info("[KTDB] {} 노선 재매핑 시도했으나 전부 실패({}개) — 수동 재작업 필요", fileName, failed);
            }
        } catch (Exception e) {
            log.warn("[KTDB] {} 노선 재매핑 실패(무시): {}", fileName, e.getMessage());
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
            return handleLargeBbox(south, west, north, east, networkId, versionId, extraWarnings, odParams, facilityOptions);
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

            // 재임포트 "이전" 버전 좌표 = 기존 정류장/역 로컬 좌표의 원점 — updateCoordinatesByKey로
            // 덮어쓰기 전에 캡처해야 재스냅 시 옛→새 원점 평행이동을 계산할 수 있다.
            Double oldOriginLat = null, oldOriginLon = null;
            if (versionId != null && !versionId.isBlank()) {
                try {
                    var oldVer = scenarioService.getVersionByKey(versionId);
                    oldOriginLat = oldVer.getLatitude();
                    oldOriginLon = oldVer.getLongitude();
                } catch (Exception ignored) { /* 버전 없음 — 첫 임포트 */ }
            }

            if (versionId != null && !versionId.isBlank()) {
                byte[] xmlBytes = networkJaxbParser.marshal(networkXml);
                fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "network.xml");
                log.info("SFTP 업로드 완료: {}/network.xml ({} bytes)", versionId, xmlBytes.length);
                // GET /network 은 DB(xml_layer_versions) 우선 — 옛 편집본 레코드를 지워야 새 XML이 반영된다
                xmlLayerVersionService.deleteVersion("network", versionId);
                try {
                    // ⚠️ 네트워크가 통째로 재생성됐으므로 이전(다른) 네트워크 기준의 회전/축척
                    // 캘리브레이션은 더 이상 의미가 없다 — 지우지 않으면 도로/차량이 서로 다른
                    // 회전/축척을 적용받아 지도 전체가 어긋나 보인다(실측 확인: scenario3_1,
                    // NetworkController.importNetworkXml과 동일 이유).
                    scenarioService.clearCalibration(versionId);
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
                final Double finalOldOriginLat = oldOriginLat, finalOldOriginLon = oldOriginLon;
                final double finalNewOriginLat = ctx.originLat(), finalNewOriginLon = ctx.originLon();
                scaffoldInProgress.add(vid);
                CompletableFuture.runAsync(() -> {
                    try {
                        nextSimScaffolder.scaffoldForImport(vid, allNodeIds, finalSourceIds, finalSinkIds,
                                finalTerminalCoords, finalNetworkXml, null, odParams);
                        try { signalTileService.invalidate(vid); }
                        catch (Exception e) { log.warn("[KTDB] 신호 타일 캐시 무효화 실패 (무시): {}", e.getMessage()); }
                        try { networkTileService.ingest(vid, resp); }
                        catch (Exception e) { log.warn("[KTDB] 타일 DB 선빌드 실패 (무시): {}", e.getMessage()); }
                        resnapExistingStationsIfNeeded(vid, finalNetworkXml.getLinks(), finalFac,
                                finalOldOriginLat, finalOldOriginLon, finalNewOriginLat, finalNewOriginLon);
                        boolean busRoutesFresh = finalFac != null && finalFac.busRoutes() != null
                                && !((List<?>) finalFac.busRoutes().getOrDefault("lines", List.of())).isEmpty();
                        if (!busRoutesFresh) remapStaleBusRoutes(vid, finalNetworkXml.getLinks());
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
            NextSimInputScaffolder.OdGenerationParams odParams,
            com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityGenerationOptions facilityOptions) {
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

            // 재임포트 "이전" 버전 좌표 캡처 — 일반 경로와 동일(재스냅 원점 평행이동용)
            Double oldOriginLat = null, oldOriginLon = null;
            if (versionId != null && !versionId.isBlank()) {
                try {
                    var oldVer = scenarioService.getVersionByKey(versionId);
                    oldOriginLat = oldVer.getLatitude();
                    oldOriginLon = oldVer.getLongitude();
                } catch (Exception ignored) { /* 버전 없음 — 첫 임포트 */ }
                // 네트워크가 통째로 재생성됐으므로 이전 캘리브레이션(회전/축척)은 무의미하다 —
                // 일반 경로(위 build())와 동일 이유(scenario3_1 실측).
                try { scenarioService.clearCalibration(versionId); }
                catch (Exception e) { log.warn("캘리브레이션 초기화 실패 (무시): {}", e.getMessage()); }
                try { scenarioService.updateCoordinatesByKey(versionId, originLat, originLon); }
                catch (Exception e) { log.warn("좌표 업데이트 실패 (무시): {}", e.getMessage()); }
                // 스트리밍 경로도 동일 — 옛 DB 편집본이 새 XML을 가리는 것 방지
                xmlLayerVersionService.deleteVersion("network", versionId);
            }

            NetworkResponse simplified = new NetworkResponse();
            simplified.setNodes(sr.nodes());
            simplified.setLinks(sr.links());

            log.info("KTDB 스트리밍 완료: 노드 {}개, 링크 {}개", sr.nodeCount(), sr.linkCount());

            // 대형망 스트리밍 경로는 완전한 NetworkXml(포트/커넥션/차선 포함)을 메모리에 안 올리지만,
            // 시설물 스냅(facilityConverter)에는 링크 id/fromNode/toNode/shape 와 터미널 노드 id만
            // 있으면 충분하다(OsmFacilityConverter.convert가 실제로 읽는 건 이게 전부 — lanes/ports
            // 는 안 씀) — 응답 반환 전(동기)에 최소 스냅용 NetworkXml을 만들어 일반 경로와 동일하게
            // OSM 버스/철도 시설물을 조회·변환한다. 예전엔 이 경로가 streamConvert는 도로 geometry만
            // 다룬다는 이유로 시설물 조회를 아예 건너뛰어, 넓은 범위(임계값 초과) 첫 임포트는 버스
            // 정류장/철도역/노선이 통째로 안 생기는 문제가 있었다.
            var linksForSnap = sr.links().stream().map(lr -> {
                var lx = new com.iitp.iitp_rest.model.network.link.LinkXml();
                lx.setId(lr.getId());
                lx.setFromNode(lr.getFromNode());
                lx.setToNode(lr.getToNode());
                lx.setShape(lr.getShape());
                return lx;
            }).toList();
            List<com.iitp.iitp_rest.model.network.node.NodeXml> terminalNodesForFacility = new java.util.ArrayList<>();
            for (Long tid : sr.sourceTerminalIds()) {
                var n = new com.iitp.iitp_rest.model.network.node.NodeXml();
                n.setId(tid);
                n.setType(com.iitp.iitp_rest.model.network.node.NodeType.Terminal);
                terminalNodesForFacility.add(n);
            }
            for (Long tid : sr.sinkTerminalIds()) {
                var n = new com.iitp.iitp_rest.model.network.node.NodeXml();
                n.setId(tid);
                n.setType(com.iitp.iitp_rest.model.network.node.NodeType.Terminal);
                terminalNodesForFacility.add(n);
            }
            NetworkXml facNetworkXml = new NetworkXml();
            facNetworkXml.setLinks(linksForSnap);
            facNetworkXml.setNodes(terminalNodesForFacility);

            com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityResult fac = null;
            try {
                var facilityRaw = overpassService.queryFacilities(south, west, north, east);
                fac = facilityConverter.convert(facilityRaw, facNetworkXml, originLat, originLon,
                        new double[]{south, west, north, east}, facilityOptions);
                log.info("KTDB(대형) 시설물(OSM 스냅): 버스정류장 {}개, 철도역 {}개, 버스노선 {}개, 철도노선 {}개",
                        fac.busStations() != null ? fac.busStations().getBusStations().size() : 0,
                        fac.railStations() != null ? fac.railStations().getRailStations().size() : 0,
                        fac.busRoutes() != null ? ((List<?>) fac.busRoutes().get("lines")).size() : 0,
                        fac.railRoutes() != null ? ((List<?>) fac.railRoutes().get("routes")).size() : 0);
            } catch (Exception e) {
                log.warn("[KTDB 대형망] OSM 시설물 조회/변환 실패(무시 — 네트워크 임포트는 계속 진행): {}", e.getMessage());
            }
            final com.iitp.iitp_rest.service.network.OsmFacilityConverter.FacilityResult finalFacForBg = fac;

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
                final Double finalOldOriginLat = oldOriginLat, finalOldOriginLon = oldOriginLon;
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
                        try { signalTileService.invalidate(vid); }
                        catch (Exception e) { log.warn("[KTDB] 신호 타일 캐시 무효화 실패 (무시): {}", e.getMessage()); }
                        try { networkTileService.ingest(vid, resp); }   // 1차: simplified 빠른 빌드
                        catch (Exception e) { log.warn("[KTDB] 타일 DB 선빌드 실패 (무시): {}", e.getMessage()); }
                        // 2차: SFTP XML 기반 완전 재빌드 — 1차 실패와 무관하게 항상 시도 (내부 예외 처리)
                        networkTileService.rebuildFromXml(vid);
                        // OSM에서 이번 임포트로 새 시설물을 받아온 경우(finalFacForBg가 신선함)엔
                        // resnapExistingStationsIfNeeded/remapStaleBusRoutes가 굳이 옛 데이터를
                        // 다시 재스냅/재매핑할 필요가 없다 — 일반(비스트리밍) 경로와 동일한 게이팅.
                        resnapExistingStationsIfNeeded(vid, linksForSnap, finalFacForBg,
                                finalOldOriginLat, finalOldOriginLon, odScaleOriginLat, odScaleOriginLon);
                        boolean busRoutesFresh = finalFacForBg != null && finalFacForBg.busRoutes() != null
                                && !((List<?>) finalFacForBg.busRoutes().getOrDefault("lines", List.of())).isEmpty();
                        if (!busRoutesFresh) remapStaleBusRoutes(vid, linksForSnap);
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
                    simplified, combinedWarnings, List.of(), List.of(),
                    fac != null ? fac.busStations() : null,
                    fac != null ? fac.railStations() : null,
                    fac != null ? fac.busRoutes() : null,
                    fac != null ? fac.railRoutes() : null,
                    true));

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
