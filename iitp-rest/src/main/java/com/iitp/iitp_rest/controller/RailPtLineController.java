package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerSaveRequest;
import com.iitp.iitp_rest.service.publicTransit.line.PtLineNestedSchemaConverter;
import com.iitp.iitp_rest.service.publicTransit.line.PtLineValidation;
import com.iitp.iitp_rest.service.publicTransit.line.RailPtLineService;
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

@Slf4j
@RestController
@RequestMapping("/public-transit/line/rail")
@RequiredArgsConstructor
public class RailPtLineController {

    static final String LAYER_KEY = "rail_pt_line";

    private final RailPtLineService railPtLineService;
    private final XmlLayerVersionService xmlLayerVersionService;
    private final PtLineNestedSchemaConverter nestedSchemaConverter;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getRailPtLine(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] GET scenarioKey={}", scenarioKey);
        try {
            Map<String, Object> result = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(railPtLineService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            if (e.getCause() instanceof java.io.IOException)
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            log.error("[RailPtLineController] 조회 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/origin/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getOriginRailPtLine(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] GET origin scenarioKey={}", scenarioKey);
        try {
            return ResponseEntity.ok(XmlLayerConverter.toMap(railPtLineService.getByScenarioKey(scenarioKey)));
        } catch (java.io.IOException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (Exception e) {
            log.error("[RailPtLineController] origin 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/histories/{scenarioKey}")
    public ResponseEntity<List<XmlLayerLog>> getHistories(@PathVariable String scenarioKey) {
        log.info("[RailPtLineController] GET histories scenarioKey={}", scenarioKey);
        return ResponseEntity.ok(xmlLayerVersionService.getLogs(LAYER_KEY, scenarioKey));
    }

    @GetMapping("/{scenarioKey}/export")
    public ResponseEntity<byte[]> exportAsXml(@PathVariable String scenarioKey) {
        try {
            Map<String, Object> data = xmlLayerVersionService.getLatest(
                    LAYER_KEY, scenarioKey,
                    () -> {
                        try { return XmlLayerConverter.toMap(railPtLineService.getByScenarioKey(scenarioKey)); }
                        catch (java.io.IOException e) { throw new RuntimeException(e); }
                    }
            );
            RailPtLineXml xml = XmlLayerConverter.fromMap(data, RailPtLineXml.class);
            byte[] bytes = railPtLineService.marshalToXml(xml);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_XML);
            headers.setContentDispositionFormData("attachment", "railPTLine_" + scenarioKey + ".xml");
            headers.setContentLength(bytes.length);
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("[RailPtLineController] export 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/{scenarioKey}")
    public ResponseEntity<?> saveRailPtLine(
            @PathVariable String scenarioKey,
            @RequestBody XmlLayerSaveRequest request) {
        log.info("[RailPtLineController] POST scenarioKey={}", scenarioKey);
        try {
            // ⚠️ railStationSeq가 비어있는 route는 경로 정보가 없어 쓸모없으므로 저장에서
            // 제외한다. 예전엔 파일 전체를 거부했으나(BusPtLineController와 동일 근거),
            // 실측(2026-08-03) 결과 NextSim이 크래시 없이 건너뛰는 것으로 확인돼 완화했다
            // (PtLineValidation.dropRailRoutesMissingStationSeq 참고).
            RailPtLineXml xml = XmlLayerConverter.fromMap(request.getData(), RailPtLineXml.class);
            List<String> droppedRoutes = PtLineValidation.dropRailRoutesMissingStationSeq(xml);
            if (!droppedRoutes.isEmpty()) {
                log.warn("[RailPtLineController] railStationSeq 없는 노선 제외 scenarioKey={}: {}", scenarioKey, droppedRoutes);
            }
            Map<String, Object> cleanData = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, cleanData, request.getLogs());
            // DB 저장과 동시에 실제 railPTline.xml 파일도 SFTP에 동기화한다
            // (SignalController.saveSignal / BusPtLineController.saveResp와 동일 패턴).
            // 이게 없으면 앱에서 철도 노선을 편집/저장해도 DB 캐시(xml_layer_versions,
            // 편집 UI/undo용)에만 반영되고, NextSim이 실제로 읽는 SFTP의 railPTline.xml은
            // 전혀 갱신되지 않아 시뮬레이션에 반영되지 않는다(import로만 실제 파일이
            // 생성되던 버스 노선과 동일 버그).
            try {
                railPtLineService.saveByScenarioKey(scenarioKey, xml);
            } catch (Exception e) {
                log.warn("[RailPtLineController] XML 파일 동기화 실패(DB는 정상 저장됨) scenarioKey={}: {}",
                        scenarioKey, e.getMessage());
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("[RailPtLineController] 저장 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** railPTLine.xml 파일 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @PostMapping("/{scenarioKey}/import")
    public ResponseEntity<Map<String, Object>> importRailPtLineXml(
            @PathVariable String scenarioKey,
            @RequestParam("file") MultipartFile file) {
        log.info("[RailPtLineController] IMPORT scenarioKey={}, size={}bytes", scenarioKey, file.getSize());
        try {
            byte[] bytes = file.getBytes();
            RailPtLineXml xml = railPtLineService.parse(new java.io.ByteArrayInputStream(bytes));
            // drop 호출 전에 재야 한다 — 호출 후에는 xml.getRoutes()가 이미 kept만 남은 목록이다.
            // BusPtLineController.importResp와 동일 이유(스키마 불일치 시 전체 제외를 프론트가
            // 인지할 수 있도록 개수를 응답에 실어 보낸다).
            int totalRouteCount = (xml.getRoutes() != null ? xml.getRoutes().size() : 0);
            List<String> droppedRoutes = PtLineValidation.dropRailRoutesMissingStationSeq(xml);
            if (!droppedRoutes.isEmpty()) {
                log.warn("[RailPtLineController] railStationSeq 없는 노선 제외 scenarioKey={}: {}", scenarioKey, droppedRoutes);
            }

            // 모든 노선이 드롭됐거나(totalRouteCount>0), 애초에 파싱된 노선 자체가 0개면
            // (=원본이 이 앱과 다른 중첩 스키마일 가능성) 부천 배포판 형태(<Mode><Lines><Line>
            // <stationSeq/></Line></Lines></Mode>)로의 변환을 시도한다. 철도는 버스와 달리
            // 래퍼 엘리먼트 이름 자체가 다르다(이 앱: <routes><route/></routes>, 부천 배포판:
            // <Lines><Line/></Lines>) — JAXB가 Line을 route로 바인딩하지 못해 xml.getRoutes()가
            // 통째로 null(0개)이 되므로, "부분 드롭"이 아니라 애초에 totalRouteCount==0으로
            // 걸린다. bus는 둘 다 루트가 "Lines"라 Line 객체 자체는 항상 파싱되고(내부
            // link/node/station만 null) totalLineCount>0인 채로 "전부 드롭"되는 게 달라 이
            // 가드가 필요 없었다 — rail은 반드시 0건도 함께 검사해야 한다(실측 확인:
            // totalRouteCount>0 가드 때문에 변환이 전혀 시도되지 않고 있었음).
            if (droppedRoutes.size() == totalRouteCount) {
                RailPtLineXml converted = nestedSchemaConverter.tryConvertRail(bytes);
                if (converted != null) {
                    xml = converted;
                    totalRouteCount = xml.getRoutes() != null ? xml.getRoutes().size() : 0;
                    droppedRoutes = PtLineValidation.dropRailRoutesMissingStationSeq(xml);
                    log.info("[RailPtLineController] 중첩 스키마 변환 성공 scenarioKey={}: {}개 노선 복구",
                            scenarioKey, totalRouteCount);
                }
            }

            Map<String, Object> data = XmlLayerConverter.toMap(xml);
            xmlLayerVersionService.save(LAYER_KEY, scenarioKey, data, new LogsData());
            railPtLineService.saveByScenarioKey(scenarioKey, xml);

            Map<String, Object> body = new java.util.HashMap<>();
            body.put("data", data);
            body.put("totalLineCount", totalRouteCount);
            body.put("droppedLineIds", droppedRoutes);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            log.error("[RailPtLineController] 임포트 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
