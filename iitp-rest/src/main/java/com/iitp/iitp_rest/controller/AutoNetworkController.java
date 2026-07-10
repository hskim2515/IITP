package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.OsmSaveResponse;
import com.iitp.iitp_rest.model.signal.SignalResponse;
import com.iitp.iitp_rest.service.network.AutoNetworkService;
import com.iitp.iitp_rest.util.FileStorageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * 자동 네트워크 생성 엔드포인트
 * 표준노드링크 bbox 필터링 기반.
 *
 * POST /network/import/auto/json  → NetworkResponse JSON
 * POST /network/import/auto/save  → SFTP 저장 + OsmSaveResponse
 */
@Slf4j
@Tag(name = "Auto Network", description = "표준노드링크 bbox 필터링 기반 자동 네트워크 생성")
@RestController
@RequestMapping("/network/import")
@AllArgsConstructor
public class AutoNetworkController {

    private final AutoNetworkService autoNetworkService;
    private final FileStorageService fileStorage;

    private void validateBbox(double south, double west, double north, double east) {
        if (south >= north) throw new IllegalArgumentException("south는 north보다 작아야 합니다.");
        if (west  >= east)  throw new IllegalArgumentException("west는 east보다 작아야 합니다.");
        if (north - south > 0.2 || east - west > 0.2)
            throw new IllegalArgumentException("bbox가 너무 큽니다 (최대 0.2° × 0.2°).");
    }

    public record AutoNetworkJsonResponse(NetworkResponse network, java.util.List<SignalResponse> signals) {}

    @Operation(summary = "정밀도로지도/표준노드링크 bbox 필터링 → NetworkResponse + Signals JSON")
    @PostMapping(value = "/auto/json", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AutoNetworkJsonResponse> generateJson(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east
    ) {
        validateBbox(south, west, north, east);
        try {
            AutoNetworkService.AutoNetworkResult result =
                    autoNetworkService.generate(south, west, north, east);
            return ResponseEntity.ok(new AutoNetworkJsonResponse(result.network(), result.signals()));
        } catch (IllegalArgumentException e) {
            log.warn("파라미터 오류: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (Exception e) {
            log.error("자동 네트워크 생성 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @Operation(summary = "표준노드링크 bbox 필터링 → SFTP 저장 + OsmSaveResponse")
    @PostMapping(value = "/auto/save", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<OsmSaveResponse> generateAndSave(
            @Parameter(description = "남쪽 위도") @RequestParam double south,
            @Parameter(description = "서쪽 경도") @RequestParam double west,
            @Parameter(description = "북쪽 위도") @RequestParam double north,
            @Parameter(description = "동쪽 경도") @RequestParam double east,
            @Parameter(description = "시나리오 버전 키") @RequestParam String versionId
    ) {
        validateBbox(south, west, north, east);
        try {
            AutoNetworkService.AutoNetworkResult result =
                    autoNetworkService.generate(south, west, north, east);

            byte[] jsonBytes = result.network().toString()
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            fileStorage.uploadFile(
                    new java.io.ByteArrayInputStream(jsonBytes), versionId, "network_auto.json");
            log.info("SFTP 저장 완료: {}/network_auto.json", versionId);

            return ResponseEntity.ok(
                    new OsmSaveResponse(result.network(), java.util.List.of(), java.util.List.of()));
        } catch (IllegalArgumentException e) {
            log.warn("파라미터 오류: {}", e.getMessage());
            return ResponseEntity.badRequest()
                    .body(new OsmSaveResponse(null, java.util.List.of(), java.util.List.of(e.getMessage())));
        } catch (Exception e) {
            log.error("자동 네트워크 생성 실패", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new OsmSaveResponse(null, java.util.List.of(), java.util.List.of(e.getMessage())));
        }
    }
}
