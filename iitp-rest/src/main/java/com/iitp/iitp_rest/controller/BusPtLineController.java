package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.OsmFacilityConverter;
import com.iitp.iitp_rest.service.publicTransit.line.BusPtLineService;
import com.iitp.iitp_rest.service.publicTransit.line.PtLineNestedSchemaConverter;
import com.iitp.iitp_rest.service.publicTransit.line.PtLineValidation;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * 버스 노선 컨트롤러
 * URL 구조: /public-transit/line/bus/{variant}/{scenarioKey}
 *   variant = (없음) | weekday | weekend
 *   action  = (없음) | histories | origin
 *
 * 경로 모호성 방지: variant 파라미터를 먼저 받고 scenarioKey를 두 번째로 받는 구조 사용
 */
@Slf4j
@RestController
@RequestMapping("/public-transit/line/bus")
@RequiredArgsConstructor
public class BusPtLineController {

    static final String LAYER_KEY_DEFAULT  = "bus_pt_line";
    static final String LAYER_KEY_WEEKDAY  = "bus_pt_line_weekday";
    static final String LAYER_KEY_WEEKEND  = "bus_pt_line_weekend";

    private final BusPtLineService busPtLineService;
    private final XmlLayerVersionService xmlLayerVersionService;
    private final NetworkService networkService;
    private final OsmFacilityConverter facilityConverter;
    private final PtLineNestedSchemaConverter nestedSchemaConverter;

    // ── default ─────────────────────────────────────────────────────
    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable String scenarioKey) {
        return fetchLatest(scenarioKey, LAYER_KEY_DEFAULT, () -> ioWrap(() -> busPtLineService.getDefault(scenarioKey)));
    }

    @GetMapping("/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOrigin(@PathVariable String scenarioKey) {
        return originResp(() -> ioWrap(() -> busPtLineService.getDefault(scenarioKey)));
    }

    @GetMapping("/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String scenarioKey) {
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY_DEFAULT, scenarioKey));
    }

    @PostMapping("/{scenarioKey}")
    public ResponseEntity<?> save(@PathVariable String scenarioKey, @RequestBody XmlLayerSaveRequest req) {
        return saveResp(LAYER_KEY_DEFAULT, scenarioKey, req);
    }

    @GetMapping("/{scenarioKey}/export")
    public ResponseEntity<byte[]> export(@PathVariable String scenarioKey) {
        return exportResp(scenarioKey, LAYER_KEY_DEFAULT, () -> ioWrap(() -> busPtLineService.getDefault(scenarioKey)),
                "roadPTline_" + scenarioKey + ".xml");
    }

    @PostMapping("/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importDefault(@PathVariable String scenarioKey, @RequestParam("file") MultipartFile file) {
        return importResp(LAYER_KEY_DEFAULT, scenarioKey, file, busPtLineService::saveDefault);
    }

    /**
     * "노선 그리기" — 지도에서 정류장을 클릭한 순서(linkRef)로 실제 도로 경로(linkSeq/nodeSeq)를
     * 자동 계산한다. KTDB 재임포트 시 낡은 노선을 재매핑하는 것과 동일한 파이프라인
     * ({@link OsmFacilityConverter#prepareLinkIndex}/{@link OsmFacilityConverter#remapBusRouteByStationAnchors},
     * {@code KtdbImportController.remapRouteFile} 참고)을 그대로 재사용한다.
     */
    @PostMapping("/{scenarioKey}/compute-path")
    public ResponseEntity<Map<String, Object>> computePath(@PathVariable String scenarioKey, @RequestBody Map<String, Object> req) {
        Object raw = req.get("stationLinkRefs");
        if (!(raw instanceof List<?> rawList) || rawList.size() < 2) {
            return ResponseEntity.badRequest().body(Map.of("message", "정류장을 2개 이상 순서대로 선택해야 합니다."));
        }
        List<Long> stationLinkRefs = rawList.stream().map(v -> ((Number) v).longValue()).toList();

        NetworkXml xml;
        try {
            xml = networkService.getNetworkXmlByVersionId(scenarioKey);
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "저장된 도로망(network.xml)이 없습니다. 도로망을 먼저 저장하세요."));
        }
        // OsmFacilityConverter는 @Service 싱글턴이라 prepareLinkIndex→prepareTerminalNodes→
        // remapBusRouteByStationAnchors 세 호출 사이에 다른 요청(동시에 노선을 완료하는 다른
        // 사용자, 또는 KTDB 재임포트)이 끼어들면 그 사이에 인스턴스 상태가 다른 네트워크로
        // 바뀌어버릴 수 있다 — 각 메서드 자체는 synchronized지만 그것만으론 이 세 호출
        // "시퀀스"가 원자적이지 않으므로, 호출부인 여기서 전체를 한 번에 락을 잡아 묶는다
        // (OsmFacilityConverter 클래스 상단 주석 참고, 2026-07-31 실사용 지적으로 발견).
        OsmFacilityConverter.RemappedRoute remap;
        synchronized (facilityConverter) {
            facilityConverter.prepareLinkIndex(xml.getLinks());
            facilityConverter.prepareTerminalNodes(xml.getNodes());
            remap = facilityConverter.remapBusRouteByStationAnchors(stationLinkRefs);
        }
        if (remap == null) {
            return ResponseEntity.unprocessableEntity()
                    .body(Map.of("message", "정류장 사이 경로를 네트워크에서 찾을 수 없습니다. 정류장 사이가 실제로 도로로 연결되어 있는지 확인하세요."));
        }
        return ResponseEntity.ok(Map.of("linkSeq", remap.linkSeq(), "nodeSeq", remap.nodeSeq()));
    }

    // ── weekday ──────────────────────────────────────────────────────
    @GetMapping("/weekday/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getWeekday(@PathVariable String scenarioKey) {
        return fetchLatest(scenarioKey, LAYER_KEY_WEEKDAY, () -> ioWrap(() -> busPtLineService.getWeekday(scenarioKey)));
    }

    @GetMapping("/weekday/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginWeekday(@PathVariable String scenarioKey) {
        return originResp(() -> ioWrap(() -> busPtLineService.getWeekday(scenarioKey)));
    }

    @GetMapping("/weekday/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistoriesWeekday(@PathVariable String scenarioKey) {
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY_WEEKDAY, scenarioKey));
    }

    @PostMapping("/weekday/{scenarioKey}")
    public ResponseEntity<?> saveWeekday(@PathVariable String scenarioKey, @RequestBody XmlLayerSaveRequest req) {
        return saveResp(LAYER_KEY_WEEKDAY, scenarioKey, req);
    }

    @GetMapping("/weekday/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportWeekday(@PathVariable String scenarioKey) {
        return exportResp(scenarioKey, LAYER_KEY_WEEKDAY, () -> ioWrap(() -> busPtLineService.getWeekday(scenarioKey)),
                "roadPTline-weekday_" + scenarioKey + ".xml");
    }

    @PostMapping("/weekday/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importWeekday(@PathVariable String scenarioKey, @RequestParam("file") MultipartFile file) {
        return importResp(LAYER_KEY_WEEKDAY, scenarioKey, file, busPtLineService::saveWeekday);
    }

    // ── weekend ──────────────────────────────────────────────────────
    @GetMapping("/weekend/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getWeekend(@PathVariable String scenarioKey) {
        return fetchLatest(scenarioKey, LAYER_KEY_WEEKEND, () -> ioWrap(() -> busPtLineService.getWeekend(scenarioKey)));
    }

    @GetMapping("/weekend/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginWeekend(@PathVariable String scenarioKey) {
        return originResp(() -> ioWrap(() -> busPtLineService.getWeekend(scenarioKey)));
    }

    @GetMapping("/weekend/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistoriesWeekend(@PathVariable String scenarioKey) {
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY_WEEKEND, scenarioKey));
    }

    @PostMapping("/weekend/{scenarioKey}")
    public ResponseEntity<?> saveWeekend(@PathVariable String scenarioKey, @RequestBody XmlLayerSaveRequest req) {
        return saveResp(LAYER_KEY_WEEKEND, scenarioKey, req);
    }

    @GetMapping("/weekend/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportWeekend(@PathVariable String scenarioKey) {
        return exportResp(scenarioKey, LAYER_KEY_WEEKEND, () -> ioWrap(() -> busPtLineService.getWeekend(scenarioKey)),
                "roadPTline-weekend_" + scenarioKey + ".xml");
    }

    @PostMapping("/weekend/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importWeekend(@PathVariable String scenarioKey, @RequestParam("file") MultipartFile file) {
        return importResp(LAYER_KEY_WEEKEND, scenarioKey, file, busPtLineService::saveWeekend);
    }

    // ── private helpers ──────────────────────────────────────────────
    private ResponseEntity<Map<String, Object>> fetchLatest(String key, String layerKey,
                                                             Supplier<Map<String, Object>> xml) {
        log.info("[BusPtLineController] GET layerKey={} key={}", layerKey, key);
        try {
            return ResponseEntity.ok(xmlLayerVersionService.getLatest(layerKey, key, xml));
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[BusPtLineController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private ResponseEntity<Map<String, Object>> originResp(Supplier<Map<String, Object>> xml) {
        try {
            return ResponseEntity.ok(xml.get());
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[BusPtLineController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private ResponseEntity<?> saveResp(String layerKey, String key, XmlLayerSaveRequest req) {
        log.info("[BusPtLineController] POST layerKey={} key={}", layerKey, key);
        try {
            // ⚠️ link/node/station seq가 비어있는 Line은 경로 정보가 없어 쓸모없으므로 저장에서
            // 제외한다. 예전엔 "NextSim이 반드시 크래시한다"는 근거로 파일 전체를 거부했으나,
            // 실측(2026-08-03) 결과 이런 라인이 있어도 NextSim은 크래시 없이 그냥 건너뛰는
            // 것으로 확인돼 완화했다(PtLineValidation.dropBusLinesMissingRouting 참고).
            BusPtLinesXml xml = XmlLayerConverter.fromMap(req.getData(), BusPtLinesXml.class);
            List<String> droppedLines = PtLineValidation.dropBusLinesMissingRouting(xml);
            if (!droppedLines.isEmpty()) {
                log.warn("[BusPtLineController] 경로 정보 없는 노선 제외 layerKey={} key={}: {}",
                        layerKey, key, droppedLines);
            }
            Map<String, Object> cleanData = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(layerKey, key, cleanData, req.getLogs());
            // DB 저장과 동시에 실제 roadPTline(-weekday/-weekend).xml 파일도 SFTP에 동기화한다
            // (SignalController.saveSignal의 "DB 저장과 동시에 signal.xml 파일도 동기화"와
            // 동일 패턴). 이 동기화가 없으면 앱에서 버스 노선을 편집/저장해도 DB 캐시
            // (xml_layer_versions, 편집 UI/undo용)에만 반영되고, NextSimRunner와
            // BusPtLineService.getDefault/Weekday/Weekend가 실제로 읽는 SFTP의 XML 파일은
            // 전혀 갱신되지 않아 시뮬레이션에 절대 반영되지 않는 문제가 있었다(실사용 발견 —
            // 지금까지 import(파일 업로드)로만 실제 roadPTline.xml이 생성되고 있었음).
            try {
                syncXmlByLayerKey(layerKey, key, xml);
            } catch (Exception e) {
                log.warn("[BusPtLineController] XML 파일 동기화 실패(DB는 정상 저장됨) layerKey={} key={}: {}",
                        layerKey, key, e.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[BusPtLineController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** layerKey(default/weekday/weekend)에 맞는 실제 SFTP XML(roadPTline[-변형].xml)로 동기화 */
    private void syncXmlByLayerKey(String layerKey, String scenarioKey, BusPtLinesXml xml) throws Exception {
        switch (layerKey) {
            case LAYER_KEY_DEFAULT -> busPtLineService.saveDefault(scenarioKey, xml);
            case LAYER_KEY_WEEKDAY -> busPtLineService.saveWeekday(scenarioKey, xml);
            case LAYER_KEY_WEEKEND -> busPtLineService.saveWeekend(scenarioKey, xml);
            default -> log.warn("[BusPtLineController] 알 수 없는 layerKey={} — XML 동기화 생략", layerKey);
        }
    }

    private ResponseEntity<byte[]> exportResp(String key, String layerKey,
                                               Supplier<Map<String, Object>> xmlFetcher, String filename) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(layerKey, key, xmlFetcher);
            BusPtLinesXml xml = XmlLayerConverter.fromMap(data, BusPtLinesXml.class);
            byte[] bytes = busPtLineService.marshalToXml(xml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[BusPtLineController] export 오류 layerKey={}", layerKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private Map<String, Object> ioWrap(IOSupplier<Object> s) {
        try { return XmlLayerConverter.toMap(s.get()); }
        catch (java.io.IOException e) { throw new RuntimeException(e); }
    }

    /** XML 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 (default/weekday/weekend 공용) */
    private ResponseEntity<Map<String, Object>> importResp(String layerKey, String scenarioKey,
                                                             MultipartFile file, FileSyncer syncer) {
        log.info("[BusPtLineController] IMPORT layerKey={} scenarioKey={} size={}bytes", layerKey, scenarioKey, file.getSize());
        try {
            byte[] bytes = file.getBytes(); // 중첩 스키마 재파싱 대비 — 재사용을 위해 미리 전량 읽음
            BusPtLinesXml xml = busPtLineService.parse(new java.io.ByteArrayInputStream(bytes));
            // ⚠️ link/node/station seq가 비어있는 Line은 경로 정보가 없어 쓸모없으므로 가져오기
            // 대상에서 제외한다. 예전엔 이런 파일 전체를 거부했으나(스키마가 다르면 JAXB가
            // 전부 null로 조용히 파싱된다는 우려 때문), 실측(2026-08-03) 결과 이런 라인이
            // 있어도 NextSim은 크래시 없이 건너뛰는 것으로 확인돼 완화했다 — 유효한 나머지
            // 노선까지 통째로 막을 이유는 없다(PtLineValidation.dropBusLinesMissingRouting).
            // drop 호출 전에 재야 한다 — 호출 후에는 xml.getLines()가 이미 kept만 남은 목록이라
            // "원래 총 개수"가 아니게 된다.
            int totalLineCount = (xml.getLines() != null ? xml.getLines().size() : 0);
            List<String> droppedLines = PtLineValidation.dropBusLinesMissingRouting(xml);

            // ⚠️ 실측(2026-08-03, 부천 배포판 roadPTline.xml): 원본이 이 앱의 평평한
            // <link seq=".."/> 스키마가 아니라 <links><link id=".." station=".."/></links>
            // 중첩 스키마면 위 파싱에서 노선 전체가 경로 정보 없이 조용히 드롭된다(31개 중
            // 31개). 이 경우(파싱 결과가 있었는데 전부 드롭됨) 중첩 스키마 변환을 시도해
            // 실제 노선 데이터를 복구한다 — 그냥 경고만 띄우는 것과 달리 사용자가 원하는
            // "노선이 실제로 생기는" 결과를 만든다(PtLineNestedSchemaConverter 참고).
            if (totalLineCount > 0 && droppedLines.size() == totalLineCount) {
                NetworkXml network = null;
                try {
                    network = networkService.getNetworkXmlByVersionId(scenarioKey);
                } catch (Exception e) {
                    log.warn("[BusPtLineController] 중첩 스키마 변환용 network.xml 조회 실패(변환 생략) scenarioKey={}: {}",
                            scenarioKey, e.getMessage());
                }
                BusPtLinesXml converted = nestedSchemaConverter.tryConvertBus(bytes, network);
                if (converted != null) {
                    xml = converted;
                    totalLineCount = xml.getLines() != null ? xml.getLines().size() : 0;
                    droppedLines = PtLineValidation.dropBusLinesMissingRouting(xml);
                    log.info("[BusPtLineController] 중첩 스키마 변환 성공 layerKey={} scenarioKey={}: {}개 노선 복구",
                            layerKey, scenarioKey, totalLineCount);
                }
            }

            if (!droppedLines.isEmpty()) {
                log.warn("[BusPtLineController] 경로 정보 없는 노선 제외 layerKey={} scenarioKey={}: {}",
                        layerKey, scenarioKey, droppedLines);
            }

            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(layerKey, scenarioKey, data, new LogsData());
            syncer.save(scenarioKey, xml);

            Map<String, Object> body = new java.util.HashMap<>();
            body.put("data", data);
            body.put("totalLineCount", totalLineCount);
            body.put("droppedLineIds", droppedLines);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            log.error("[BusPtLineController] 임포트 오류 layerKey={}", layerKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @FunctionalInterface
    interface IOSupplier<T> { T get() throws java.io.IOException; }

    @FunctionalInterface
    interface FileSyncer { void save(String scenarioKey, BusPtLinesXml xml) throws Exception; }
}
