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

    public enum RunState { RUNNING, DONE, ERROR, CANCELLED }

    public static final class RunStatus {
        public volatile RunState state = RunState.RUNNING;
        public volatile String stage = "대기 중...";
        /** 프론트 체크리스트용 분류된 단계 키 — classifyStep() 결과, 원시 로그 등으로 분류 불가하면 이전 값 유지 */
        public volatile String stepKey = "STAGING";
        public volatile String error;
        public final long startedAt = System.currentTimeMillis();
        public volatile long finishedAt;
        /** 마지막 진행 출력 시각 — "멈춘 건지 도는 건지" 하트비트용 */
        public volatile long lastStageAt = System.currentTimeMillis();
    }

    private final ConcurrentHashMap<String, RunStatus> statusMap = new ConcurrentHashMap<>();
    /** versionId → 직전 성공 실행 총 소요초. 진행률/ETA 추정용(서버 재시작 시 소실 — statusMap과 동일 트레이드오프) */
    private final ConcurrentHashMap<String, Long> lastRunDurationSeconds = new ConcurrentHashMap<>();

    /**
     * NextSimRunner.run() 이 넘기는 진행 메시지(정제된 한국어 문구 + 바이너리 원시 stdout 라인이
     * 섞여 있음)를 체크리스트용 단계 키로 분류한다. 매칭되는 접두어/부분문자열이 없으면(원시 로그 등)
     * null 을 반환 — 호출부는 이때 이전 stepKey 를 그대로 유지해야 한다(분류 불가로 체크리스트가
     * 흔들리면 안 됨). 각 리터럴은 NextSimRunner.java 의 실제 progress.accept(...) 문구와 반드시
     * 일치해야 한다(그쪽에도 이 사실을 알리는 NOTE 주석을 남겨둠).
     */
    private static String classifyStep(String stage) {
        if (stage == null) return null;
        if (stage.startsWith("입력 데이터 스테이징")) return "STAGING";
        if (stage.startsWith("네트워크 정합성 보정")) return "VALIDATING";
        if (stage.startsWith("경로 캐시 재사용") || stage.startsWith("경로 생성 중")
                || stage.contains("RouteGenerator 크래시 복구")) return "ROUTE_GEN";
        if (stage.startsWith("시뮬레이션 실행 중") || stage.contains("Simulation 크래시 복구")) return "SIMULATION";
        if (stage.startsWith("결과 저장 중")) return "SAVING";
        return null;
    }

    private record ProgressEstimate(int percent, long etaSeconds) {}

    /**
     * 직전 같은 versionId 성공 실행 소요시간(historySeconds) 기준으로 이번 실행의 진행률/ETA를
     * 추정한다. 이력이 없으면(첫 실행) null — 호출부는 이때 progressPercent/etaSeconds 필드
     * 자체를 응답에서 생략해야 한다. 실제 소요가 이력을 넘어서도(크래시 복구 등) 폭주하지 않도록
     * 99%/0초에서 클램프한다 — 100%로 보이면 "끝난 것"처럼 오인되므로 99%로 상한.
     */
    private static ProgressEstimate computeProgress(long elapsedSeconds, long historySeconds) {
        if (historySeconds <= 0) return null;
        int percent = (int) Math.min(99, Math.round(elapsedSeconds * 100.0 / historySeconds));
        long eta = Math.max(0, historySeconds - elapsedSeconds);
        return new ProgressEstimate(percent, eta);
    }

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
                nextSimRunner.run(versionId, stage -> {
                    status.stage = stage;
                    status.lastStageAt = System.currentTimeMillis();
                    String key = classifyStep(stage);
                    if (key != null) status.stepKey = key;
                });
                nextSimRunner.cleanup(versionId);
                status.state = RunState.DONE;
                status.stage = "완료";
                // finally 에서 finishedAt 을 세팅하기 전이므로 직접 경과를 계산한다.
                lastRunDurationSeconds.put(versionId, (System.currentTimeMillis() - status.startedAt) / 1000);
            } catch (NextSimRunner.CancelledException e) {
                log.info("[SimulationController] NextSim 실행 취소됨: {}", versionId);
                status.state = RunState.CANCELLED;
                status.stage = "취소됨";
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

    /** 실행 취소 — 컨테이너 강제 종료 후 상태는 실행 스레드가 CANCELLED 로 마감 */
    @DeleteMapping("/{versionId}/run")
    public ResponseEntity<Map<String, Object>> cancel(@PathVariable String versionId) {
        RunStatus s = statusMap.get(versionId);
        if (s == null || s.state != RunState.RUNNING) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "실행 중이 아닙니다"));
        }
        boolean accepted = nextSimRunner.requestCancel(versionId);
        if (!accepted) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "취소할 활성 실행이 없습니다"));
        }
        return ResponseEntity.ok(Map.of("message", "취소 요청됨"));
    }

    @GetMapping("/{versionId}/status")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String versionId) {
        RunStatus s = statusMap.get(versionId);
        if (s == null) return ResponseEntity.ok(Map.of("state", "IDLE"));
        long end = s.finishedAt > 0 ? s.finishedAt : System.currentTimeMillis();
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("state", s.state.name());
        body.put("stage", s.stage);
        body.put("stepKey", s.stepKey);
        body.put("elapsedSeconds", (end - s.startedAt) / 1000);
        // 하트비트: 마지막 출력 후 경과 — 출력이 뜸한 단계(경로 생성 등)에서 살아있음 표시용
        if (s.state == RunState.RUNNING) {
            body.put("sinceOutputSeconds", (System.currentTimeMillis() - s.lastStageAt) / 1000);
            Long history = lastRunDurationSeconds.get(versionId);
            if (history != null) {
                ProgressEstimate est = computeProgress((end - s.startedAt) / 1000, history);
                if (est != null) {
                    body.put("progressPercent", est.percent());
                    body.put("etaSeconds", est.etaSeconds());
                }
            }
        }
        if (s.error != null) body.put("error", s.error);
        return ResponseEntity.ok(body);
    }
}
