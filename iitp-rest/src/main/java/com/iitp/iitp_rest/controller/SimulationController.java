package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.service.simulation.NextSimRunner;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * NextSim 시뮬레이션 실행 API.
 *
 * <pre>
 * POST /simulation/{versionId}/run     실행 시작 (202) — 이미 실행 중이면 409
 * GET  /simulation/{versionId}/status  {state, stage, elapsedSeconds, error?}
 * GET  /simulation/available           러너 설정 여부 (프론트 버튼 노출 판단)
 * </pre>
 *
 * 완료되면 {versionId}/vehicle_sim.db 가 갱신되어 기존 차량 가시화
 * (스트리밍/집계/히트맵) 파이프라인이 그대로 소비한다.
 */
@Slf4j
@RestController
@RequestMapping("/simulation")
@RequiredArgsConstructor
public class SimulationController {

    private final NextSimRunner nextSimRunner;

    /** 시뮬은 무거우므로 전역 1개씩만 실행 */
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "nextsim-runner");
        t.setDaemon(true);
        return t;
    });

    public enum RunState { RUNNING, DONE, ERROR }

    public static final class RunStatus {
        public volatile RunState state = RunState.RUNNING;
        public volatile String stage = "대기 중...";
        public volatile String error;
        public final long startedAt = System.currentTimeMillis();
        public volatile long finishedAt;
    }

    private final ConcurrentHashMap<String, RunStatus> statusMap = new ConcurrentHashMap<>();

    @GetMapping("/available")
    public ResponseEntity<Map<String, Object>> available() {
        return ResponseEntity.ok(Map.of("available", nextSimRunner.isConfigured()));
    }

    @PostMapping("/{versionId}/run")
    public ResponseEntity<Map<String, Object>> run(@PathVariable String versionId) {
        if (!nextSimRunner.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("message", "NextSim 이 설정되지 않았습니다 (nextsim.home)"));
        }
        RunStatus existing = statusMap.get(versionId);
        if (existing != null && existing.state == RunState.RUNNING) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("message", "이미 실행 중입니다", "stage", existing.stage));
        }
        RunStatus status = new RunStatus();
        statusMap.put(versionId, status);
        executor.submit(() -> {
            try {
                log.info("[SimulationController] NextSim 실행 시작: {}", versionId);
                nextSimRunner.run(versionId, stage -> status.stage = stage);
                nextSimRunner.cleanup(versionId);
                status.state = RunState.DONE;
                status.stage = "완료";
            } catch (Exception e) {
                log.error("[SimulationController] NextSim 실행 실패: {}", versionId, e);
                status.state = RunState.ERROR;
                status.error = e.getMessage();
            } finally {
                status.finishedAt = System.currentTimeMillis();
            }
        });
        return ResponseEntity.accepted().body(Map.of("message", "시뮬레이션 시작", "versionId", versionId));
    }

    @GetMapping("/{versionId}/status")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String versionId) {
        RunStatus s = statusMap.get(versionId);
        if (s == null) return ResponseEntity.ok(Map.of("state", "IDLE"));
        long end = s.finishedAt > 0 ? s.finishedAt : System.currentTimeMillis();
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("state", s.state.name());
        body.put("stage", s.stage);
        body.put("elapsedSeconds", (end - s.startedAt) / 1000);
        if (s.error != null) body.put("error", s.error);
        return ResponseEntity.ok(body);
    }
}
