package com.iitp.iitp_rest.service.simulation;

import com.iitp.iitp_rest.model.vehicle.type.VehicleType;
import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeParameter;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.util.FileStorageService;
import com.iitp.iitp_rest.util.VehicleDataReader;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NextSim(KAIST 교통 시뮬레이터) 실행 인터페이스.
 *
 * <p>배포판(nextsim-linux-x64) 바이너리를 Docker(linux/amd64)로 실행한다.
 * 버전 스토리지의 입력 파일(network.xml / signal.xml / signalTOD.xml / odmatrix.xml /
 * scenario.xml / passenger.xml — 모두 NextSim 형식 그대로 플랫폼이 관리 중)을 실행 워크스페이스에
 * 스테이징하고, route-generator → nextsim 순으로 실행한 뒤 결과
 * simulation_output.db 를 그대로 {versionId}/vehicle_sim.db 로 회수한다
 * (NextSim VehicleEvent 스키마 == 백엔드 VehicleDataReader 신형 스키마 — 변환 불필요).
 *
 * <p>워크스페이스 레이아웃 (배포판은 읽기 전용으로만 사용):
 * <pre>
 * {workspace}/run_{versionId}/
 *   SimulationInput/
 *     config.txt                          network_name=iitp, branch=mesopt
 *     datasets/mesopt/parameter_xml/      배포판에서 복사 (네트워크 무관 파라미터)
 *     datasets/mesopt/network_xml_iitp/   버전 데이터 + 생성 템플릿
 *   SimulationOutput/                     결과 (nextsim이 생성)
 * </pre>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NextSimRunner {

    /** NextSim 배포판 루트 (예: /opt/nextsim-linux-x64-v1.0). 미설정 시 실행 불가 안내. */
    @Value("${nextsim.home:}")
    private String nextsimHome;

    /**
     * 실행 모드: docker(기본) / native.
     * native 는 배포판 바이너리를 직접 exec — Linux x86_64 서버 전용 (mac 에선 실행 불가).
     * mac 개발기의 amd64 에뮬레이션 오버헤드가 없어 대규모 네트워크에서 수 배 빠르다.
     */
    @Value("${nextsim.execution-mode:docker}")
    private String executionMode;

    /** 바이너리가 Ubuntu 22.04 x86_64 빌드 → 동일 계열 이미지 + amd64 에뮬레이션(mac) */
    @Value("${nextsim.docker.image:ubuntu:22.04}")
    private String dockerImage;

    @Value("${nextsim.docker.platform:linux/amd64}")
    private String dockerPlatform;

    /** route-generator + nextsim 전체 제한 시간 (대규모 네트워크 고려) */
    @Value("${nextsim.timeout-seconds:3600}")
    private int timeoutSeconds;

    @Value("${nextsim.workspace:${java.io.tmpdir}/nextsim-runs}")
    private String workspaceBase;

    /** OD 가 참조하지 않는 터미널을 스테이징 사본에서 normal 로 전환 — route-generator 의
     *  전 터미널 쌍 계산을 OD 관련 쌍으로 축소 (대규모 네트워크 실행 가능성의 핵심) */
    @Value("${nextsim.prune-unused-terminals:true}")
    private boolean pruneUnusedTerminals;

    private static final String BRANCH = "mesopt";
    private static final String NETWORK_NAME = "iitp";

    /** 승객 수요가 있을 때 PT 정류장(버스+철도) 총합의 실측 위험 임계치 — pax-route-generator/
     *  nextsim hang 최소 재현치(29개, footpath 1087노드 기준)보다 낮게 잡은 보수적 값. 실행을
     *  막지는 않고(2026-08-03, 사용자 요청 — nextsim 본체도 동일 결함을 재현해 이 단계만 막아도
     *  근본 해결이 안 됨) 경고 로그만 남긴다. {@link #buildFootpathNetworkFromNodes}/
     *  {@link #countPtStations} 참고. */
    private static final int MAX_SAFE_PT_STATION_COUNT_WITH_DEMAND = 25;

    private final FileStorageService fileStorage;
    private final VehicleDataReader vehicleDataReader;
    private final ScenarioVersionRepository scenarioVersionRepository;
    private final com.iitp.iitp_rest.repository.VehicleTypeRepository vehicleTypeRepository;
    private final com.iitp.iitp_rest.repository.VehicleTypeParameterRepository vehicleTypeParameterRepository;
    private final com.iitp.iitp_rest.service.publicTransit.line.BusPtLineService busPtLineService;
    private final com.iitp.iitp_rest.service.publicTransit.station.BusStationService busStationService;
    private final com.iitp.iitp_rest.service.publicTransit.line.RailPtLineService railPtLineService;

    /** 취소 요청으로 종료된 실행 (컨트롤러가 CANCELLED 로 구분) */
    public static class CancelledException extends RuntimeException {
        public CancelledException() { super("사용자 취소"); }
    }

    // 전역 1개 실행(컨트롤러 single executor) 전제의 활성 실행 추적 — 취소용
    private volatile String activeVersionId;
    private volatile String activeContainer;
    private volatile Process activeProcess;
    private final java.util.Set<String> cancelRequested = java.util.concurrent.ConcurrentHashMap.newKeySet();

    /**
     * 실행 취소 요청.
     * docker: CLI 프로세스만 죽이면 컨테이너가 계속 돌므로 컨테이너를 이름으로 강제 제거.
     * native: 바이너리 프로세스(+자식)를 직접 종료.
     */
    public boolean requestCancel(String versionId) {
        if (!versionId.equals(activeVersionId)) return false;
        cancelRequested.add(versionId);
        String container = activeContainer;
        if (container != null) {
            try {
                new ProcessBuilder("docker", "rm", "-f", container).start().waitFor(15, TimeUnit.SECONDS);
            } catch (Exception e) {
                log.warn("[NextSimRunner] 컨테이너 강제 제거 실패: {}", e.getMessage());
            }
        }
        Process p = activeProcess;
        if (p != null) {
            p.descendants().forEach(ProcessHandle::destroyForcibly); // native: 바이너리 자식까지
            p.destroyForcibly();
        }
        log.info("[NextSimRunner] 취소 요청 처리: versionId={}, mode={}, container={}", versionId, executionMode, container);
        return true;
    }

    public boolean isConfigured() {
        return !nextsimHome.isBlank() && Files.isDirectory(Path.of(nextsimHome, "Captain", "build", "bin"));
    }

    /**
     * 시뮬레이션 실행 (동기 — 호출측에서 별도 스레드로 감쌀 것).
     *
     * @param versionId 대상 버전 (데이터 식별자)
     * @param progress  단계 문자열 콜백 (상태 조회용)
     * @return 실행 로그 요약 (마지막 부분)
     */
    public String run(String versionId, Consumer<String> progress) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException(
                    "nextsim.home 이 설정되지 않았거나 배포판 구조가 아닙니다: '" + nextsimHome + "' — " +
                    "application.properties 에 nextsim.home=/path/to/nextsim-linux-x64-v1.0 을 설정하세요.");
        }

        Path workDir = Path.of(workspaceBase, "run_" + sanitize(versionId));
        deleteDir(workDir); // 이전 실행 잔재 제거
        Path inputDir = workDir.resolve("SimulationInput");
        Path outputDir = workDir.resolve("SimulationOutput");
        Path networkDir = inputDir.resolve("datasets").resolve(BRANCH).resolve("network_xml_" + NETWORK_NAME);
        Files.createDirectories(networkDir);
        Files.createDirectories(outputDir);

        activeVersionId = versionId;
        cancelRequested.remove(versionId);
        try {
            // NOTE: SimulationController.classifyStep()이 이 문구의 접두어로 매칭 — 문구를 바꾸면 그쪽도 같이 고칠 것.
            progress.accept("입력 데이터 스테이징 중...");
            stageInputs(versionId, inputDir, networkDir, progress);

            // 경로 캐시: route-generator 는 odmatrix 와 무관하게 **네트워크의 전 터미널 쌍**을
            // 계산한다(실측 — 2-demand OD 와 2021-demand OD 의 Route.json 이 동일). 따라서
            // 캐시 키 = 스테이징(보정·가지치기 후) network.xml 만. OD 의 flow 만 바뀐 재실행은
            // 가장 비싼 단계인 route-generator 를 통째로 생략한다.
            // (터미널 가지치기 사용 시 OD 의 터미널 집합이 바뀌면 스테이징 network 도 바뀌어
            //  자연히 캐시 미스 → 정확성 유지)
            // ⚠️ PTRoute.json 은 route-generator 가 network.xml 뿐 아니라 roadPTline.xml/
            // roadStation.xml(버스)·railPTline.xml/railStation.xml(철도)도 입력으로 사용한다
            // (generate_routes.sh 주석: "Generate Route.json and PTRoute.json"). network.xml만
            // 해시하면 버스/철도 노선만 새로 만들거나 수정한 경우 캐시가 그대로 히트해 이전(노선
            // 추가 전) PTRoute.json 이 재사용되고, NextSim 이 새 노선의 경로를 못 찾아
            // ("PT Error: No route found for line ...") 이후 출력 없이 CPU 100%로 무한 행(hang)
            // 한다 — 실측(scenario3_1, TEST_LINE_1 버스 노선 추가 후 재현, doctest FAILURE
            // 시그니처 없이 조용히 멈춤이라 크래시 감지 로직도 못 잡음). 따라서 PT 관련 입력
            // 파일도 캐시 키에 포함시켜 노선/정류장 변경 시 반드시 route-generator 를 재실행한다.
            // passenger.xml(승객 OD 수요)도 포함 — PaxRoute.json(아래)이 이 파일에서 파생된다.
            String inputsHash = sha256Of(networkDir.resolve("network.xml"),
                    networkDir.resolve("roadPTline.xml"), networkDir.resolve("roadStation.xml"),
                    networkDir.resolve("railPTline.xml"), networkDir.resolve("railStation.xml"),
                    networkDir.resolve("passenger.xml"));
            Path cacheDir = routeCacheDir(versionId);
            Path routeJson = networkDir.resolve("Route.json");
            Path paxRouteJson = networkDir.resolve("PaxRoute.json");
            if (isRouteCacheHit(cacheDir, inputsHash)) {
                // NOTE: SimulationController.classifyStep()이 이 문구의 접두어로 매칭 — 문구를 바꾸면 그쪽도 같이 고칠 것.
                progress.accept("경로 캐시 재사용 — 경로 생성 생략");
                Files.copy(cacheDir.resolve("Route.json"), routeJson,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                Path cachedPt = cacheDir.resolve("PTRoute.json");
                if (Files.exists(cachedPt)) {
                    Files.copy(cachedPt, networkDir.resolve("PTRoute.json"),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
                Path cachedPax = cacheDir.resolve("PaxRoute.json");
                if (Files.exists(cachedPax)) {
                    Files.copy(cachedPax, paxRouteJson, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
                log.info("[NextSimRunner] 경로 캐시 히트: {} (hash={})", versionId, inputsHash.substring(0, 12));
            } else {
                // NOTE: SimulationController.classifyStep()이 이 문구의 접두어로 매칭 — 문구를 바꾸면 그쪽도 같이 고칠 것.
                progress.accept("경로 생성 중 (route-generator)...");
                String routeLog = runStageWithCrashRecovery(
                        versionId, workDir, networkDir, "route-generator", "RouteGenerator", progress);
                if (!Files.exists(routeJson)) {
                    throw new RuntimeException("route-generator 가 Route.json 을 생성하지 않았습니다. " +
                            "odmatrix.xml 의 source/sink 노드가 네트워크와 일치하는지 확인하세요.\n" + tail(routeLog, 800));
                }
                // PaxRoute.json: 시뮬레이션 엔진이 대중교통 노선/정류장이 하나라도 있으면
                // 무조건 참조한다 — 파일 자체가 없으면 "vector::_M_range_check: __n=0 >= size=0"
                // (빈 vector 인덱싱)로 즉시 크래시함을 실측(scenario3_1, TEST_LINE_1 버스 노선
                // 추가 후 재현). 그렇다고 pax-route-generator 를 무조건 돌리면 안 된다 — 실측:
                // 승객 OD 수요가 없는(=passenger.xml 이 빈 스텁인) 상태에서도 전체 정류장 쌍에 대해
                // 경로를 계산하려다 OOMKilled(docker inspect State.OOMKilled=true, 호스트 메모리
                // 15.6GB 전체를 다 쓰고 죽음 — route-generator/nextsim 과 같은 계열의 NextSim
                // 바이너리 결함으로 추정)된다. generate_routes.sh 도 이걸 --with-pax 로 선택적
                // 취급(기본 OFF)한다 — 실제 승객 수요가 있을 때만 돌리고, 없으면 스키마만 맞는
                // 빈 stub 을 직접 써서 파일 부재로 인한 크래시만 막는다(계산 비용 0, OOM 위험 없음).
                if (hasPassengerDemand(networkDir.resolve("passenger.xml"))) {
                    // ⚠️ 실측 확정(2026-08-03, gdb): 승객 수요가 있어 footpathNetwork.xml이 존재하는
                    // 상태에서 PT 정류장(버스+철도) 총합이 일정 수를 넘으면 pax-route-generator
                    // 뿐 아니라 nextsim 본체(ExecuteSimulation → NetInitializer → PaxRouteGenerator)
                    // 도 Captain::footpath::FindNearestFootpathLinkPoint 에서 영원히 안 끝나는
                    // 무한루프에 빠진다(닫힌소스 결함, memcmp 반복 호출 확인). 이진탐색으로
                    // 확정: footpath 1087노드 기준 28개는 성공/29개부터 hang, 다른 29개 조합으로도
                    // 재현 — 정류장 정체성과 무관한 순수 개수 임계치. footpathNetwork.xml을
                    // intersection 전용으로 축소(buildFootpathNetworkFromNodes 참고)하면 임계치가
                    // 올라가지만(부천 실측 17노드 기준 35개 성공/45개부터 hang) 축소 후 정확한
                    // 임계치는 네트워크마다 달라 예측 불가능하다.
                    // ⚠️ 사전 차단은 넣지 않는다(2026-08-03, 사용자 요청) — nextsim 본체가 정류장
                    // 수와 무관하게 자체적으로 같은 결함을 재현하므로(위 gdb 확인), 이 단계만 막아도
                    // 근본 해결이 안 되고 정상 규모 네트워크까지 막을 위험이 크다. 대신 로그로
                    // 위험 신호만 남겨 hang 발생 시 원인 파악에 쓴다.
                    int stationCount = countPtStations(networkDir.resolve("roadStation.xml"), networkDir.resolve("railStation.xml"));
                    if (stationCount > MAX_SAFE_PT_STATION_COUNT_WITH_DEMAND) {
                        log.warn("[NextSimRunner] {} 버스+철도 정류장이 {}개로 실측 안전선({}개)을 초과 — " +
                                "pax-route-generator/nextsim이 정류장 좌표 조회 단계에서 무한 대기에 빠질 위험이 있습니다.",
                                versionId, stationCount, MAX_SAFE_PT_STATION_COUNT_WITH_DEMAND);
                    }
                    // pax-route-generator 는 route-generator 와 다른 크래시 클래스(터미널 격리로
                    // 해결되는 문제가 아님)라 크래시 복구 이분탐색 래퍼는 적용하지 않는다.
                    runStage(versionId, workDir, "pax-route-generator", "PaxRouteGenerator", progress);
                } else {
                    Files.writeString(paxRouteJson, "{\n    \"PaxRoute\": []\n}", StandardCharsets.UTF_8);
                    log.info("[NextSimRunner] {} 승객 OD 수요 없음 — PaxRoute.json 빈 stub 사용(pax-route-generator 생략)", versionId);
                }
            }

            // route-generator 직후(=Route.json 이 완성된 시점) 스냅샷 — 캐시는 이 시점 기준으로
            // 저장한다. nextsim 단계에서 크래시 복구가 추가로 network.xml 을 건드리거나(노드
            // 재격리) nextsim 자신이 Route.json 을 다시 열어 쓰는 경우(실측: 복구 재시도 시
            // Route.json 이 0바이트로 잘리는 현상 발생 — nextsim 이 쓰기 모드로 열고 실패)에도
            // 캐시가 "route-generator 가 실제로 만든 유효한 Route.json"을 가리키게 한다.
            // ⚠️ inputsHash(캐시 조회 키)와 반드시 같은 파일 집합을 해시해야 한다 — 다르면
            // 저장된 해시가 조회 시 절대 일치하지 않아(파일 개수 자체가 다름) 캐시가 매번
            // 무조건 미스한다(정확성엔 문제 없으나 캐시 이점이 통째로 사라짐 — 실측으로 발견).
            String routeGenHash = sha256Of(networkDir.resolve("network.xml"),
                    networkDir.resolve("roadPTline.xml"), networkDir.resolve("roadStation.xml"),
                    networkDir.resolve("railPTline.xml"), networkDir.resolve("railStation.xml"),
                    networkDir.resolve("passenger.xml"));
            Path routeJsonSnapshot = networkDir.resolveSibling("Route.json.snapshot");
            Files.copy(routeJson, routeJsonSnapshot, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            Path ptRouteJson = networkDir.resolve("PTRoute.json");
            Path ptRouteJsonSnapshot = Files.exists(ptRouteJson)
                    ? networkDir.resolveSibling("PTRoute.json.snapshot") : null;
            if (ptRouteJsonSnapshot != null) {
                Files.copy(ptRouteJson, ptRouteJsonSnapshot, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
            Path paxRouteJsonSnapshot = Files.exists(paxRouteJson)
                    ? networkDir.resolveSibling("PaxRoute.json.snapshot") : null;
            if (paxRouteJsonSnapshot != null) {
                Files.copy(paxRouteJson, paxRouteJsonSnapshot, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }

            // NOTE: SimulationController.classifyStep()이 이 문구의 접두어로 매칭 — 문구를 바꾸면 그쪽도 같이 고칠 것.
            progress.accept("시뮬레이션 실행 중 (nextsim)...");
            // route-generator 와 동일한 std::out_of_range 크래시가 시뮬레이션 엔진 자체에서도
            // 발생함을 실측(원인 불명의 특정 터미널 노드 — route-generator 단계를 통과했어도
            // nextsim 의 "Initializing Terminals/Garage" 초기화 단계에서 별도로 재현될 수 있음)
            // → 동일한 개별 격리 재시도를 여기도 적용.
            // ⚠️ 알려진 단순화: 이 단계에서 노드를 격리해도 Route.json(위 스냅샷)은 재생성하지
            // 않는다 — 그 노드를 지나는 기존 경로 항목이 남을 수 있음. 지금까지 실측 범위에선
            // 시뮬레이션 결과 자체엔 문제 없었으나, 추가 크래시 유형으로 나타나면 이 단계에서
            // Route.json 도 함께 무효화하는 방향으로 확장 필요.
            String simLog = runStageWithCrashRecovery(
                    versionId, workDir, networkDir, "nextsim", "Simulation", progress);

            Path resultDb = outputDir.resolve("simulation_output.db");
            if (!Files.exists(resultDb) || Files.size(resultDb) == 0) {
                throw new RuntimeException("시뮬레이션 결과(simulation_output.db)가 생성되지 않았습니다.\n" + tail(simLog, 800));
            }

            // NOTE: SimulationController.classifyStep()이 이 문구의 접두어로 매칭 — 문구를 바꾸면 그쪽도 같이 고칠 것.
            progress.accept("결과 저장 중...");
            // NextSim VehicleEvent 스키마 == VehicleDataReader 신형 스키마 → 그대로 vehicle_sim.db 로
            try (InputStream in = new FileInputStream(resultDb.toFile())) {
                fileStorage.uploadFile(in, versionId, "vehicle_sim.db");
            }
            vehicleDataReader.invalidateDbCache(versionId);

            // 경로 캐시 갱신 — 다음 실행(같은 network/OD)은 route-generator 생략.
            // route-generator 직후 스냅샷(routeGenHash/routeJsonSnapshot) 기준으로 저장 —
            // route-generator 크래시 복구로 노드가 격리된 상태는 반영하면서(원본 해시와 다르므로
            // 다음 실행이 원본 network.xml 로 재크래시하지 않음), nextsim 단계가 Route.json 을
            // 건드렸어도 영향받지 않는다.
            saveRouteCache(cacheDir, routeGenHash, routeJsonSnapshot,
                    ptRouteJsonSnapshot != null ? ptRouteJsonSnapshot : ptRouteJson,
                    paxRouteJsonSnapshot != null ? paxRouteJsonSnapshot : paxRouteJson);
            // ⚠️ 실측 확인(2026-08-03): 여기서 .snapshot 을 바로 지우면 finally 블록의
            // persistGeneratedArtifactsForInspection() 이 실행되는 시점엔 이미 없어져서, 정작
            // 그 함수가 우선 사용하려던 "route-generator 직후 유효한" 스냅샷을 못 쓰고 nextsim이
            // 건드렸을 수 있는 networkDir 라이브 파일로 폴백해버린다(성공 실행에서도 재현 —
            // saveRouteCache 로 route_cache 엔 정상 저장되는데 generated/ 스냅샷만 빈 배열이 되는
            // 버그였음). 명시적으로 안 지워도 다음 run() 호출 시작의 deleteDir(workDir)(위 164행)가
            // workDir 전체를 지우므로 정리는 자동으로 된다 — 여기서 굳이 먼저 지울 필요가 없다.

            log.info("[NextSimRunner] 완료: versionId={}, result={} bytes", versionId, Files.size(resultDb));
            return tail(simLog, 2000);
        } finally {
            // 성공/실패 무관하게 그 시점까지 생성된 JSON 산출물을 정식 저장 위치에 스냅샷
            // (확인용 — 다음 실행의 입력으로 재사용하지 않음, 경로 캐시(route_cache, 재사용
            // 목적)와는 별개). workDir는 다음 run() 호출 시작 시 deleteDir로 지워지므로, 여기서
            // 옮겨두지 않으면 실패한 실행을 다시 실행하는 순간 그 증거(config_scenario.json/
            // Route.json 등)가 사라진다 — 사용자가 크래시 원인 파악을 위해 직접 열어볼 수
            // 있게 남긴다.
            persistGeneratedArtifactsForInspection(versionId, networkDir);
            activeVersionId = null;
            activeProcess = null;
            activeContainer = null;
            // 결과 회수 후 워크스페이스 정리 (실패 시엔 디버깅용으로 보존)
        }
    }

    /** 실행 중 생성된 JSON 산출물(config_scenario.json/Route.json/PTRoute.json/PaxRoute.json)을
     *  {@code {versionId}/generated/} 아래에 스냅샷으로 남긴다 — 순수 확인/디버깅용이라 이후
     *  어떤 실행도 이 스냅샷을 다시 읽지 않는다(캐시 아님, 무효화 로직 불필요). 존재하는
     *  파일만 복사하고, 그 시점에 아직 안 만들어졌으면 조용히 건너뛴다 — 실행 자체를 절대
     *  막으면 안 되므로 실패해도 로그만 남기고 삼킨다.
     *
     * <p>⚠️ 실측 확인(2026-08-03): Route.json/PTRoute.json은 {@code networkDir}에서 직접 읽으면
     * 안 된다 — nextsim 단계(위 runStageWithCrashRecovery)가 자체 크래시 복구 재시도 중에 이
     * 파일들을 쓰기 모드로 열었다가 실패해 0바이트/빈 배열로 잘라먹는 현상이 실측으로 이미
     * 알려져 있다(위 routeGenHash 스냅샷 로직이 이 문제를 회피하려고 만들어진 것과 동일 원인).
     * 이 메서드가 그 사실을 놓치고 있어서 route-generator가 실제로 60개 노선을 전부 성공
     * 계산했는데도(route_cache에는 정상 저장됨) {@code generated/PTRoute.json}에는 빈 배열이
     * 저장되는 버그가 있었다 — routeGenHash 스냅샷({@code Route.json.snapshot}/
     * {@code PTRoute.json.snapshot})이 있으면 그쪽을 우선 사용한다. */
    private void persistGeneratedArtifactsForInspection(String versionId, Path networkDir) {
        String[] artifacts = { "config_scenario.json", "Route.json", "PTRoute.json", "PaxRoute.json" };
        for (String name : artifacts) {
            Path snapshot = networkDir.resolveSibling(name + ".snapshot");
            Path src = Files.exists(snapshot) ? snapshot : networkDir.resolve(name);
            if (!Files.exists(src)) continue;
            try (InputStream in = new FileInputStream(src.toFile())) {
                fileStorage.uploadFile(in, versionId + "/generated", name);
            } catch (Exception e) {
                log.warn("[NextSimRunner] {} 산출물 스냅샷 저장 실패(무시) {}: {}", versionId, name, e.getMessage());
            }
        }
    }

    // ─────────────────────────── 경로 캐시 ───────────────────────────

    private Path routeCacheDir(String versionId) {
        return Path.of(workspaceBase, "route_cache", sanitize(versionId));
    }

    private boolean isRouteCacheHit(Path cacheDir, String inputsHash) {
        try {
            Path hashFile = cacheDir.resolve("inputs.sha256");
            return Files.exists(hashFile)
                    && inputsHash.equals(Files.readString(hashFile).trim())
                    && Files.exists(cacheDir.resolve("Route.json"));
        } catch (IOException e) {
            return false;
        }
    }

    private void saveRouteCache(Path cacheDir, String inputsHash, Path routeJson, Path ptRouteJson,
                                 Path paxRouteJson) {
        try {
            Files.createDirectories(cacheDir);
            Files.copy(routeJson, cacheDir.resolve("Route.json"),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            if (Files.exists(ptRouteJson)) {
                Files.copy(ptRouteJson, cacheDir.resolve("PTRoute.json"),
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
            if (Files.exists(paxRouteJson)) {
                Files.copy(paxRouteJson, cacheDir.resolve("PaxRoute.json"),
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
            Files.writeString(cacheDir.resolve("inputs.sha256"), inputsHash);
        } catch (IOException e) {
            log.warn("[NextSimRunner] 경로 캐시 저장 실패(무시): {}", e.getMessage());
        }
    }

    /** 입력 파일들의 결합 SHA-256 (스트림 — 수백 MB 대응) */
    private static String sha256Of(Path... files) throws IOException {
        try {
            var md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[1 << 20];
            for (Path f : files) {
                try (InputStream in = Files.newInputStream(f)) {
                    int n;
                    while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
                }
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 실행 성공 후 워크스페이스 정리 (컨트롤러가 성공 시 호출) */
    public void cleanup(String versionId) {
        deleteDir(Path.of(workspaceBase, "run_" + sanitize(versionId)));
    }

    // ─────────────────────────── 입력 스테이징 ───────────────────────────

    private void stageInputs(String versionId, Path inputDir, Path networkDir, Consumer<String> progress) throws IOException {
        // 1) config.txt
        Files.writeString(inputDir.resolve("config.txt"),
                "network_name=" + NETWORK_NAME + "\nbranch=" + BRANCH + "\n", StandardCharsets.UTF_8);

        // 2) parameter_xml — 배포판에서 복사 (네트워크 무관)
        Path srcParam = Path.of(nextsimHome, "SimulationInput", "datasets", BRANCH, "parameter_xml");
        Path dstParam = inputDir.resolve("datasets").resolve(BRANCH).resolve("parameter_xml");
        copyDir(srcParam, dstParam);
        // recordMode 플랫폼 튜닝: 백엔드 소비 경로는 VehicleEvent(Visualizer)뿐 —
        //   Debugging(26컬럼/차량/timestep)·UniformEvent(CellEvent: 셀×timestep, 대규모에서 행 수 폭발)는
        //   미소비 기록이라 끔 → 시뮬 쓰기 부하·결과 DB 크기 절감. Statistics(집계)는 가벼워 유지
        //   (NEXTSIM_DATA_STRUCTURE.md: recordMode.xml 이 기록 테이블 제어 지점).
        //   SignalEvent/SignalControlEvent는 2026-08-03 signalControl.active=true 활성화와 함께
        //   켬 — 신호 반영이 실제로 적용되는지 SignalControlEvent 테이블로 검증하려는 목적
        //   (기존엔 신호 자체를 안 봤으니 로그도 의미가 없어 꺼져 있었음).
        Files.writeString(dstParam.resolve("recordMode.xml"), xml(
                "<RecordModes>\n" +
                "    <VehicleEvent>\n" +
                "        <Debugging active=\"f\" />\n" +
                "        <Visualizer active=\"t\" />\n" +
                "        <Statistics active=\"t\" />\n" +
                "    </VehicleEvent>\n" +
                "    <PassengerEvent active=\"t\" />\n" +
                "    <UniformEvent active=\"f\" />\n" +
                "    <StationEvent active=\"t\" />\n" +
                "    <SinkEvent active=\"t\" />\n" +
                "    <SignalEvent active=\"t\" />\n" +
                "    <SignalControlEvent active=\"t\" />\n" +
                "</RecordModes>"), StandardCharsets.UTF_8);

        // vehicletypes.xml: "교통수단 유형" 편집 화면(VehicleType/VehicleTypeParameter)의
        // 내용으로 배포판 템플릿을 덮어쓴다 — 편집 화면에서 고친 차종별 주행 파라미터(veh_len/
        // jamgap/vf/reaction_time/max_acc/max_dec/lc_param1/lc_param2/lc_sensitivity)가
        // 실제 실행에 반영되게 하려는 목적. 등록된 차종이 하나도 없으면(화면을 아직 안 채운
        // 경우) 배포판 템플릿을 그대로 둔다 — 빈 파일로 덮어써 실행을 깨뜨리지 않기 위함.
        String vehicleTypesXml = buildVehicleTypesXml();
        if (vehicleTypesXml != null) {
            Files.writeString(dstParam.resolve("vehicletypes.xml"), vehicleTypesXml, StandardCharsets.UTF_8);
        }

        // 3) 버전 스토리지 파일 (플랫폼이 NextSim 형식 그대로 관리 중)
        //    network.xml 필수, odmatrix.xml 필수(수요 없으면 시뮬 무의미), 나머지는 폴백 생성
        copyRequired(versionId, "network.xml", networkDir,
                "network.xml 이 없습니다 — 네트워크를 먼저 가져오기/저장하세요.");
        copyRequired(versionId, "odmatrix.xml", networkDir,
                "odmatrix.xml 이 없습니다 — OD 매트릭스 메뉴에서 수요를 생성/저장하세요.");
        // 파일은 있는데 수요가 전부 0/없음 → 시뮬은 "성공"하지만 차량 0대 — 혼란만 남으므로 명시 에러
        requirePositiveDemand(networkDir.resolve("odmatrix.xml"));
        // NOTE: SimulationController.classifyStep()이 이 문구의 접두어로 매칭 — 문구를 바꾸면 그쪽도 같이 고칠 것.
        progress.accept("네트워크 정합성 보정 중 (고립 노드 격리 · 도달 가능성 검증)...");
        // KTDB 변환 네트워크 호환 보정 + 미사용 터미널 가지치기 (스테이징 사본, 단일 패스):
        // - NextSim 파서가 <port direction>/<node v2x> 를 필수 속성으로 요구(실측) → 빈 값 주입
        // - route-generator 는 odmatrix 무관 **전 터미널 쌍** 최단경로를 계산(실측 — 수도권
        //   11,895 터미널 = ~3,500만 쌍으로 77분+ 미완의 근본 원인). OD 가 참조하지 않는
        //   터미널을 normal 로 바꾸면 OD 관련 쌍만 계산된다. 미사용 터미널은 막다른 경계
        //   노드라 어떤 경로도 통과하지 않음 → 수요가 참조하지 않는 한 시뮬 결과 불변.
        // ⚠️ 실측 크래시(2026-08-03, scenario3_1): "OD 미참조 = 안전하게 가지치기 가능"이라는
        // 전제는 차량 OD 수요 관점에서만 성립한다 — 버스 노선(roadPTline.xml)의 실제 경로
        // 시작/끝 노드도 route-generator가 반드시 type="terminal"로 요구하는데(문서화된 별개
        // 결함: #roadptline-xml), 그 노드가 OD에 안 걸리면 이 가지치기가 terminal→garage로
        // 바꿔버려 터미널 조합과 무관하게 항상 크래시했다(31개 이분탐색 전부 실패로 재현).
        // OD source/sink 집합에 버스 노선 종점도 합쳐서 가지치기 대상에서 제외한다.
        Set<String> odNodeIds = pruneUnusedTerminals ? extractOdNodeIds(networkDir.resolve("odmatrix.xml")) : null;
        if (odNodeIds != null) odNodeIds.addAll(extractBusRouteEndpointNodeIds(versionId));
        injectRequiredNetworkAttrs(networkDir.resolve("network.xml"), odNodeIds);
        // 방향성(일방통행) 기준 도달 불가능한 OD 수요 제거 (실측 확정 근본원인 — gdb):
        // route-generator 는 도달 불가능한 (source,sink) 쌍도 에러 없이 빈 경로로 처리해
        // "SUCCESS" 보고하고, nextsim 이 그 수요의 경로를 조회하려다 std::out_of_range 로
        // 크래시한다(InitializeVehicleDemand/RouteGenerator::ExtractVehicleRoutesWithMetadata
        // 양쪽에서 동일 메커니즘 확인). OD 생성/편집 시점에도 걸러내지만(1차 방어),
        // 어떤 경로로 만들어진 OD든(수동 XML 업로드 등) 최종 실행 직전에 한 번 더 걸러낸다.
        filterUnreachableDemands(networkDir.resolve("network.xml"), networkDir.resolve("odmatrix.xml"));

        if (!copyOptional(versionId, "signal.xml", networkDir)) {
            Files.writeString(networkDir.resolve("signal.xml"),
                    xml("<Signal id=\"0\">\n</Signal>"), StandardCharsets.UTF_8);
            log.warn("[NextSimRunner] {} signal.xml 없음 — 빈 신호로 실행", versionId);
        }
        if (!copyOptional(versionId, "signalTOD.xml", networkDir)) {
            Files.writeString(networkDir.resolve("signalTOD.xml"),
                    xml("<TOD id=\"0\">\n</TOD>"), StandardCharsets.UTF_8);
        }
        if (!copyOptional(versionId, "scenario.xml", networkDir)) {
            // 기본: 06시 시작 60분, OD 0번, TOD 0번 (시뮬레이션 시나리오 메뉴에서 관리 가능)
            // ⚠️ signalControl="True": 2026-08-03 사용자 확정 — 부천 데이터로 hang이 재현됨을
            // 알고도 신호 반영 시뮬레이션을 켜기로 결정(NextSim 바이너리 버그 위험 감수).
            Files.writeString(networkDir.resolve("scenario.xml"), xml(
                    "<Scenarios>\n" +
                    "\t<Scenario id=\"0\" startTime=\"06:00:00\" duration=\"60\" BGTduration=\"0\" odMatrixID=\"0\" todID=\"0\" signalControl=\"True\"/>\n" +
                    "</Scenarios>"), StandardCharsets.UTF_8);
        }
        writeConfigScenarioJson(networkDir);

        // 4) mode.xml — meso 에 전체 링크 지정 (mesoscopic 시뮬, bucheon 예시와 동일 방식)
        Set<String> linkIds = extractLinkIds(networkDir.resolve("network.xml"));
        StringBuilder mode = new StringBuilder(xml("<Periods>"));
        mode.append("\n  <period id=\"1\" stime=\"0\">\n    <micro linkid=\" \" />\n    <meso linkid=\"");
        mode.append(String.join(" ", linkIds));
        mode.append("\" />\n  </period>\n</Periods>\n");
        Files.writeString(networkDir.resolve("mode.xml"), mode.toString(), StandardCharsets.UTF_8);
        log.info("[NextSimRunner] mode.xml 생성: meso 링크 {}개", linkIds.size());

        // 5) 네트워크 종속이지만 플랫폼 미관리 파일 — 빈 템플릿 (배포판 bucheon 스키마 준수,
        //    아래 형태들은 실행 이진탐색으로 무해 검증됨)
        writeIfAbsent(networkDir, "events.xml", xml("<Events />"));
        if (!copyOptional(versionId, "passenger.xml", networkDir)) {
            Files.writeString(networkDir.resolve("passenger.xml"),
                    xml("<Passenger>\n\t<od_pax>\n\t</od_pax>\n</Passenger>"), StandardCharsets.UTF_8);
        }
        // roadStation.xml: 우리 BusStationXml/PublicTransitXml 스키마(id/link_ref/lane_ref/
        // pos/center/parkingLots/line)가 NextSim이 기대하는 형식과 이미 거의 동일해서 변환
        // 없이 그대로 복사한다 — signal.xml과 동일한 copyOptional 패턴.
        if (!copyOptional(versionId, "roadStation.xml", networkDir)) {
            Files.writeString(networkDir.resolve("roadStation.xml"),
                    xml("<PublicTransit>\n  <Stations>\n  </Stations>\n</PublicTransit>"), StandardCharsets.UTF_8);
        }
        // roadPTline.xml: 우리 스키마(<Line id interval><link seq="공백구분 id목록"/>...)는
        // NextSim이 기대하는 형식(<Line id fee interval><links><link id seq station
        // use_ptlane/></links></Line>)과 달라 그대로 복사할 수 없다 — "버스 노선"/"버스
        // 정류장" 데이터를 읽어 직접 변환한다(vehicletypes.xml과 동일한 "DB에서 직접 생성"
        // 패턴). 노선 데이터가 없으면(아직 안 그림) 안전한 빈 스텁을 그대로 쓴다.
        // ⚠️ railPTline.xml과 달리 이 변환 로직은 아직 실제 NextSim 바이너리로 검증되지
        // 않았다 — 버스 노선이 있는 시나리오로 처음 실행할 땐 결과를 주의 깊게 확인할 것.
        String roadPtLineXml = buildRoadPtLineXml(versionId);
        Files.writeString(networkDir.resolve("roadPTline.xml"),
                roadPtLineXml != null ? roadPtLineXml : xml("<Lines mode=\"Bus\">\n</Lines>"),
                StandardCharsets.UTF_8);

        // ⚠️ 실측 발견(2026-07-27): roadStation.xml과 달리 railStation.xml은 SFTP에서 실제
        // 저장된 데이터를 가져오는 copyOptional 호출이 아예 없었다 — 항상 빈 스텁만 써서
        // "철도 정류장" 편집 화면에 실제 역을 등록해도 시뮬레이션에는 단 하나도 반영되지
        // 않았다(railPTline.xml이 참조하는 역 id가 railStation.xml에 전혀 없는 상태가 되어,
        // 크래시는 안 나지만 열차가 조용히 배차되지 않는 원인이었던 것으로 추정). RailStationXml
        // 스키마는 roadStation.xml과 마찬가지로 NextSim 실제 스키마와 이미 호환(RailStationService
        // SFTP 동기화 수정 시 name 속성도 채우도록 보강함) — 그대로 복사만 하면 된다.
        if (!copyOptional(versionId, "railStation.xml", networkDir)) {
            Files.writeString(networkDir.resolve("railStation.xml"),
                    xml("<RailPublicTransit>\n</RailPublicTransit>"), StandardCharsets.UTF_8);
        }
        writeIfAbsent(networkDir, "backgroundTraffic.xml", xml("<BackgroundTraffics>\n</BackgroundTraffics>"));
        // railPTline.xml: 실제 철도 노선 데이터가 있으면 "철도 노선" 편집 화면 데이터로 생성한다
        // (roadPTline.xml과 동일한 "DB에서 직접 생성" 패턴).
        // ⚠️ 실측 회귀 발견(2026-07-27): 데이터가 없을 때 "제대로 된 root+Lines, 내용만 빈"
        // stub(<Mode type="subway"><Lines></Lines></Mode>)으로 바꿨다가, 철도 노선이 전혀
        // 없는 기존 시나리오(scenario1_1 등, 이번 세션에서 전혀 건드리지 않은 시나리오 포함)
        // 까지 전부 "Complete: Initializing Public Transit" 직후 출력 없이 CPU 100%로 무한
        // 행(hang)하는 전역 회귀로 이어졌다 — bucheon 배포판 예시를 그대로 복사하던 이전 동작
        // (semantically 잘못된 역 참조를 담고 있음에도)에서는 재현되지 않던 증상. 즉 "내용이
        // 빈 self-authored XML이 nextsim을 죽인다"던 기존 주석이 실제로는 SIGSEGV뿐 아니라
        // 이런 무한 행 형태로도 나타나는 것으로 재확인됨 — 이 stub 형태 자체가 여전히 위험하다.
        // 따라서 데이터 없을 때는 안전이 실측 확인된 bucheon 번들 예시 복사로 되돌린다(회귀
        // 이전 동작 복원). 실제 철도 노선 데이터가 있을 때만 새 생성 로직을 쓰되, 이 경로는
        // 아직 end-to-end 성공 검증 전이므로(생성된 콘텐츠로도 같은 지점에서 행 재현됨)
        // 주의해서 사용할 것 — 원인 미해결.
        String railPtLineXml = buildRailPtLineXml(versionId);
        if (railPtLineXml != null) {
            Files.writeString(networkDir.resolve("railPTline.xml"), railPtLineXml, StandardCharsets.UTF_8);
        } else if (!Files.exists(networkDir.resolve("railPTline.xml"))) {
            Path bundled = Path.of(nextsimHome, "SimulationInput", "datasets", BRANCH,
                    "network_xml_bucheon", "railPTline.xml");
            if (Files.exists(bundled)) {
                Files.copy(bundled, networkDir.resolve("railPTline.xml"));
            } else {
                throw new IOException("배포판 railPTline.xml 예시가 없습니다: " + bundled +
                        " — 버전에 railPTline.xml 을 직접 추가하세요.");
            }
        }

        // ⚠️ 실측 확인(scenario2_1, 2026-07-28): footpathNetwork.xml을 항상 빈 스텁으로 두면
        // NextSim이 PT 정류장 위치에서 "가장 가까운 보행 네트워크 지점"을 못 찾아
        // (Captain::footpath::FindNearestFootpathLinkPoint) "GetDistance Error: Could not
        // find nearest link point for origin (...)"로 실패하고 시뮬레이션이 불안정해졌다.
        // ⚠️ 게이팅 기준 정정: PT 정류장 존재 여부가 아니라 승객 OD 수요(hasPassengerDemand,
        // PaxRoute.json 실제 생성 여부와 동일 조건 — 아래 route-generator 단계 참고) 기준이어야
        // 한다 — footpathNetwork.xml은 PaxRoute.json을 만들 때만 있어야 함. 정류장은 있어도
        // 승객 수요가 없으면 pax-route-generator 자체가 안 돌아 footpath 조회가 발생하지 않고,
        // 반대로 파일이 불필요하게 남아있으면 안 된다는 걸 확인했다. 위에서 이미 확정된
        // roadStation.xml/railStation.xml 존재 여부가 아니라 passenger.xml을 검사한다.
        // NEXTSIM_DATA_STRUCTURE.md 문서화된 footpathNetwork.xml 스키마(node: id/type/
        // x_coord/y_coord/v2x/num_port/num_connection)는 network.xml의 노드를 그대로
        // 미러링한 형태다.
        if (!copyOptional(versionId, "footpathNetwork.xml", networkDir)) {
            if (hasPassengerDemand(networkDir.resolve("passenger.xml"))) {
                Files.writeString(networkDir.resolve("footpathNetwork.xml"),
                        buildFootpathNetworkFromNodes(networkDir.resolve("network.xml")), StandardCharsets.UTF_8);
            } else {
                Files.deleteIfExists(networkDir.resolve("footpathNetwork.xml"));
            }
        }
    }

    /**
     * footpathNetwork.xml: network.xml의 **intersection 타입 노드만** 미러링한다(같은 id,
     * center의 "x y"를 x_coord/y_coord로 분리).
     *
     * <p>⚠️ 실측 확정(2026-08-03, gdb): 원래는 network.xml의 전체 노드(수백~수천 개, terminal/
     * garage/normal 포함)를 그대로 미러링했는데, {@code pax-route-generator}/{@code nextsim}이
     * 내부적으로 호출하는 {@code Captain::footpath::FindNearestFootpathLinkPoint}가 이 footpath
     * 노드 수와 PT 정류장 수의 조합이 일정 규모를 넘으면(우리 KTDB 네트워크 1087노드 기준
     * 정류장 29개부터) 무한루프에 빠지는 닫힌소스 결함이 gdb로 확인됨(문자열 키 체인 조회가
     * 종료 안 됨, memcmp 반복 호출로 스핀). 부천 배포판 실측 예시의 footpathNetwork.xml은
     * 애초에 intersection 타입만(17개, 전체 253노드 중) 담고 있었다 — 이 관례를 따르면 같은
     * 정류장 수 기준으로 안전 임계치가 크게 올라간다(부천 방식 17노드 기준 임계치 35~45,
     * vs 전체 미러링 1087노드 기준 28). terminal/garage/normal은 원래도 이 함수의 대상이
     * 아니라고 추정되며(교차로만 있어도 부천 데이터가 실제로 정상 라우팅됨, PaxRoute.json
     * 1056건 생성 확인) 제외해도 기능 손실이 없다.
     */
    private String buildFootpathNetworkFromNodes(Path networkXml) throws IOException {
        StringBuilder sb = new StringBuilder(xml("<Network id=\"0\">\n    <nodes>\n"));
        Pattern p = Pattern.compile(
                "<node id=\"([^\"]+)\" type=\"([^\"]+)\" num_port=\"([^\"]+)\" num_connection=\"([^\"]+)\"[^>]*center=\"([^\"]+)\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8)) {
            char[] buf = new char[1 << 22];
            String carry = "";
            int n;
            int count = 0;
            int totalScanned = 0;
            while ((n = reader.read(buf)) > 0) {
                String chunk = carry + new String(buf, 0, n);
                Matcher m = p.matcher(chunk);
                while (m.find()) {
                    totalScanned++;
                    if (!"intersection".equals(m.group(2))) continue; // terminal/garage/normal 제외 (위 주석 참고)
                    String[] xy = m.group(5).trim().split("\\s+");
                    if (xy.length < 2) continue;
                    sb.append("        <node id=\"").append(m.group(1))
                      .append("\" type=\"").append(m.group(2))
                      .append("\" x_coord=\"").append(xy[0])
                      .append("\" y_coord=\"").append(xy[1])
                      .append("\" v2x=\"\" num_port=\"").append(m.group(3))
                      .append("\" num_connection=\"").append(m.group(4))
                      .append("\"/>\n");
                    count++;
                }
                carry = chunk.length() > 512 ? chunk.substring(chunk.length() - 512) : chunk;
            }
            log.info("[NextSimRunner] footpathNetwork.xml 생성: intersection 노드 {}개 (전체 {}개 중 — pax-route-generator hang 완화를 위해 축소)",
                    count, totalScanned);
        }
        sb.append("    </nodes>\n    <links>\n    </links>\n</Network>");
        return sb.toString();
    }

    /** scenario.xml 내용을 config_scenario.json 으로 미러링 (배포판이 양쪽을 두는 관례 준수) */
    private void writeConfigScenarioJson(Path networkDir) throws IOException {
        String xml = Files.readString(networkDir.resolve("scenario.xml"), StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("<Scenario\\s+([^/>]*)/>").matcher(xml);
        List<String> items = new ArrayList<>();
        while (m.find()) {
            String attrs = m.group(1);
            // ⚠️ 2026-08-03: signalControl만 scenario.xml 실제 값을 안 읽고 항상 false로 박아
            // 넣던 회귀 — id/startTime/duration 등 다른 필드는 전부 attr()로 읽는데 이것만
            // 리터럴이었다. scenario.xml의 signalControl 속성을 읽어 그대로 반영한다.
            boolean signalControlActive = "true".equalsIgnoreCase(attr(attrs, "signalControl", "False"));
            items.add(String.format(
                    "        {\n            \"id\": %s,\n            \"startTime\": \"%s\",\n            \"duration\": %s,\n" +
                    "            \"BGTduration\": %s,\n            \"odMatrixID\": %s,\n            \"todID\": %s,\n" +
                    "            \"trafficCenter\": {\n                \"signalControl\": { \"active\": %s, \"interval\": 1.0 },\n" +
                    "                \"v2x\": { \"active\": false, \"interval\": 1.0 }\n            }\n        }",
                    attr(attrs, "id", "0"), attr(attrs, "startTime", "06:00:00"), attr(attrs, "duration", "60"),
                    attr(attrs, "BGTduration", "0"), attr(attrs, "odMatrixID", "0"), attr(attrs, "todID", "0"),
                    signalControlActive));
        }
        Files.writeString(networkDir.resolve("config_scenario.json"),
                "{\n    \"Scenarios\": [\n" + String.join(",\n", items) + "\n    ]\n}\n", StandardCharsets.UTF_8);
    }

    private static String attr(String attrs, String name, String def) {
        Matcher m = Pattern.compile(name + "\\s*=\\s*\"([^\"]*)\"").matcher(attrs);
        return m.find() ? m.group(1) : def;
    }

    /**
     * NextSim 필수 속성 주입 + (옵션) 미사용 터미널 가지치기 (스테이징 사본 in-place, 원본 무변경).
     * 태그 단위 스트림 처리 — 수백 MB 파일 대응 (DOM 금지). shape 속성이 수십 KB 인
     * 태그도 있으므로 '<'~'>' 를 온전히 모아 태그 단위로 변환한다.
     *
     * @param keepNodeIds null 이면 가지치기 안 함. 아니면 이 집합에 없는 terminal 노드를
     *                    type="normal" 로 전환 (route-generator 전 터미널 쌍 계산 축소)
     */
    private void injectRequiredNetworkAttrs(Path networkXml, Set<String> keepNodeIds) throws IOException {
        // 분단 컴포넌트 터미널 격리 (실측: 대전 오정동 bbox — 4개 연결요소 중 2개가
        // 3노드 고립 섬, 터미널이 섬에 걸쳐 있으면 route-generator 가 전 터미널 쌍 최단경로
        // 계산 중 도달불가 쌍에서 std::out_of_range 크래시(OD 내용과 무관 — 빈 OD 도 재현,
        // route-generator 는 odmatrix 무관 network.xml 의 전 터미널을 열거하기 때문).
        // 최대 연결요소 밖 터미널은 OD 참조 여부와 무관하게 garage 로 전환 — 도달 불가능한
        // 쌍 자체를 만들지 않는다(그 경로는 실제로도 존재하지 않으므로 의미상 정확).
        Set<String> mainComponentIds = computeMainComponentNodeIds(networkXml);

        Path tmp = networkXml.resolveSibling(networkXml.getFileName() + ".compat");
        long injected = 0, pruned = 0, keptTerminals = 0, isolatedPruned = 0;
        long connFixedNodes = 0;
        Pattern idAttr = Pattern.compile("\\bid=\"([^\"]+)\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8);
             var writer = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            StringBuilder tag = null;
            int c;
            while ((c = reader.read()) >= 0) {
                char ch = (char) c;
                if (tag == null) {
                    if (ch == '<') { tag = new StringBuilder("<"); } else { writer.write(ch); }
                    continue;
                }
                tag.append(ch);
                if (ch != '>') continue;
                String t = tag.toString();
                tag = null;
                // "<port " 공백 포함 매칭 — "<ports>"/"<nodes>" 래퍼 태그 오주입 방지
                if (t.startsWith("<port ") && !t.contains("direction=")) {
                    t = t.replaceFirst("(/?>)$", " direction=\"\"$1");
                    injected++;
                } else if (t.startsWith("<node ")) {
                    if (!t.contains("v2x=")) {
                        t = t.replaceFirst("(/?>)$", " v2x=\"\"$1");
                        injected++;
                    }
                    // KTDB 보정: connection 0 인 비터미널(막다른/미연결) 노드는 route-generator 가
                    // 통과 노드로 취급하다 std::out_of_range 크래시(부천 51개 실측, 23링크 최소
                    // 재현체로 확정). terminal 로 전환하면 소스/싱크 후보가 되고, OD 미참조 시
                    // 아래 가지치기가 garage 로 무시 처리 — 시뮬 의미 불변.
                    if (t.contains("num_connection=\"0\"")
                            && !t.contains("type=\"terminal\"") && !t.contains("type=\"garage\"")) {
                        t = t.replaceFirst("type=\"\\w+\"", "type=\"terminal\"");
                    }
                    if (t.contains("type=\"terminal\"")) {
                        Matcher m = idAttr.matcher(t);
                        String nid = m.find() ? m.group(1) : null;
                        if (nid != null && !mainComponentIds.isEmpty() && !mainComponentIds.contains(nid)) {
                            // 최대 연결요소 밖 — OD 참조 여부와 무관하게 격리(도달 불가능한 쌍 원천 차단)
                            t = t.replace("type=\"terminal\"", "type=\"garage\"");
                            isolatedPruned++;
                        } else if (keepNodeIds != null && nid != null && !keepNodeIds.contains(nid)) {
                            // garage: 막다른(단일 포트) 노드의 정식 타입 — "normal" 로 바꾸면
                            // route-generator 가 std::out_of_range 크래시(실측, 통과 노드 가정),
                            // garage 는 소스/싱크 열거에서 빠지면서 그래프 로드도 안전(실측 검증).
                            t = t.replace("type=\"terminal\"", "type=\"garage\"");
                            pruned++;
                        } else {
                            keptTerminals++;
                        }
                    }
                    // KTDB 보정 2: 통과 노드(비터미널)의 in-link 에 나가는 커넥션이 없거나
                    // out-link 로 들어오는 커넥션이 없으면 route-generator std::out_of_range
                    // (부천 40링크 최소 재현체로 확정 — 누락 커넥션 채우면 SUCCESS).
                    // KTDB 변환기의 커넥션 생성 누락(부천 237건, 수도권 1,317건 실측)을
                    // 스테이징 사본에서 직진(0→0) 커넥션으로 보완한다.
                    if (!t.endsWith("/>")
                            && !t.contains("type=\"terminal\"") && !t.contains("type=\"garage\"")) {
                        String block = t + readUntilCloseTag(reader, "</node>");
                        // 블록 통째 처리라 태그 단위 port 분기를 안 거침 — direction 주입을 여기서도
                        block = PORT_NO_DIRECTION.matcher(block).replaceAll("$1 direction=\"\"$2");
                        String fixed = fillMissingConnections(block);
                        if (!fixed.equals(block)) connFixedNodes++;
                        writer.write(fixed);
                        continue;
                    }
                }
                writer.write(t);
            }
            if (tag != null) writer.write(tag.toString()); // 비정상 트레일링 보존
        }
        Files.move(tmp, networkXml, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        if (injected > 0) log.info("[NextSimRunner] network.xml 호환 보정: 필수 속성 {}건 주입", injected);
        if (connFixedNodes > 0) log.info("[NextSimRunner] 누락 커넥션 보완: {}개 노드", connFixedNodes);
        if (keepNodeIds != null) {
            log.info("[NextSimRunner] 터미널 가지치기: 유지 {} / 전환 {} (OD 참조 노드 {}개)",
                    keptTerminals, pruned, keepNodeIds.size());
        }
        if (isolatedPruned > 0) {
            log.warn("[NextSimRunner] 분단 컴포넌트 터미널 격리: {}개 (최대 연결요소 밖 — OD 로 참조해도 도달 불가하므로 garage 전환)",
                    isolatedPruned);
        }
    }

    /**
     * network.xml 을 스트림 스캔해 (undirected) 링크 인접을 구성하고 최대 연결요소의
     * 노드 id 집합을 반환한다. 수백 MB 파일 대응 — 태그 속성만 추출(DOM 로드 금지),
     * extractLinkIds 와 동일한 4MB+carry 청크 스캔 패턴.
     *
     * @return 최대 연결요소 노드 id 집합. 컴포넌트가 1개(전부 연결)면 빈 Set — 호출부는
     *         빈 Set 을 "제약 없음"으로 해석해 모든 노드를 통과시킨다.
     */
    private static Set<String> computeMainComponentNodeIds(Path networkXml) throws IOException {
        Set<String> allNodeIds = new HashSet<>();
        Map<String, List<String>> adj = new HashMap<>();
        Pattern nodeIdPat = Pattern.compile("<node id=\"([^\"]+)\"");
        Pattern linkPat = Pattern.compile("<link id=\"[^\"]+\" from_node=\"([^\"]+)\" to_node=\"([^\"]+)\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8)) {
            char[] buf = new char[1 << 22]; // 4MB
            String carry = "";
            int n;
            while ((n = reader.read(buf)) > 0) {
                String chunk = carry + new String(buf, 0, n);
                Matcher nm = nodeIdPat.matcher(chunk);
                while (nm.find()) allNodeIds.add(nm.group(1));
                Matcher lm = linkPat.matcher(chunk);
                while (lm.find()) {
                    String f = lm.group(1), t = lm.group(2);
                    adj.computeIfAbsent(f, k -> new ArrayList<>()).add(t);
                    adj.computeIfAbsent(t, k -> new ArrayList<>()).add(f);
                }
                carry = chunk.length() > 512 ? chunk.substring(chunk.length() - 512) : chunk;
            }
        }
        if (allNodeIds.isEmpty()) return Set.of();

        Set<String> visited = new HashSet<>();
        Set<String> largest = Set.of();
        int componentCount = 0;
        for (String start : allNodeIds) {
            if (visited.contains(start)) continue;
            componentCount++;
            Set<String> comp = new HashSet<>();
            Deque<String> stack = new ArrayDeque<>();
            stack.push(start);
            while (!stack.isEmpty()) {
                String cur = stack.pop();
                if (!comp.add(cur)) continue;
                for (String nb : adj.getOrDefault(cur, List.of())) {
                    if (!comp.contains(nb)) stack.push(nb);
                }
            }
            visited.addAll(comp);
            if (comp.size() > largest.size()) largest = comp;
        }
        if (componentCount <= 1) return Set.of(); // 단일 컴포넌트 — 제약 불필요
        log.warn("[NextSimRunner] network.xml 이 {}개 연결요소로 분단됨 (최대 {}개 노드, 나머지 {}개는 격리 대상)",
                componentCount, largest.size(), allNodeIds.size() - largest.size());
        return largest;
    }

    /**
     * 실제 회전 허용(커넥션) 그래프 기준으로 sink 에 도달 불가능하거나, source/sink 가
     * 최종적으로 type="terminal" 이 아니게 된 OD 수요를 odmatrix.xml 에서 제거한다.
     *
     * <p>실측(gdb) 확인된 두 가지 별개 실패 패턴:
     * <ol>
     *   <li><b>도달 불가능</b>(scenario1_2 11000174, 대전 오정동 전체 유지 베이스라인, 최신
     *       재임포트 11000357 모두 확인): route-generator 는 (source,sink) 사이에 실제 통행
     *       가능한 경로가 없어도 에러 없이 빈 경로로 처리해 "SUCCESS" 를 보고하고, nextsim 이
     *       그 수요의 경로를 찾으려다 {@code InitializeVehicleDemand()} 에서 std::out_of_range
     *       로 크래시한다. <b>단순 링크 인접(무방향은 물론 방향성으로도)만으론 부족함이
     *       gdb로 확정됨</b> — 링크가 서로 이어져 있어도, 경로상의 어떤 교차로에 그 회전을
     *       허용하는 {@code <connection>} 이 없으면(교차로마다 허용된 회전만 명시적으로 나열)
     *       실제로는 통행 불가능하다(실측: 11000357 — 방향성 링크 그래프로는 도달 가능해
     *       보였지만 실제 커넥션 그래프로는 불가능, route-generator가 Route.json 을 빈 채로
     *       남김을 직접 확인). 그래서 이 메서드는 노드가 아니라 <b>링크</b> 단위로 그래프를
     *       구성하고(노드의 커넥션 = from_link→to_link 간선), 터미널의 out-link 에서 시작해
     *       그 반대 터미널의 in-link 에 도달하는지로 판정한다.</li>
     *   <li><b>source/sink 가 terminal 이 아니게 됨</b>(실측: 격리된 소규모 섬 안에 있는 두
     *       노드끼리는 서로 커넥션 경로가 있어 위 체크는 통과하지만, 둘 다 메인 컴포넌트 밖이라
     *       {@code injectRequiredNetworkAttrs} 가 garage 로 전환했다 — route-generator/nextsim
     *       은 garage 노드를 수요 처리 대상에서 제외하므로 이 수요도 같은 크래시로 이어진다).
     *       순수 그래프 도달 가능성만으론 못 잡고, 최종 network.xml 에서 실제 노드 타입을
     *       확인해야만 걸러진다.</li>
     * </ol>
     */
    private static void filterUnreachableDemands(Path networkXml, Path odMatrixXml) throws IOException {
        Map<String, List<String>> nodeOutLinks = new HashMap<>();
        Map<String, List<String>> nodeInLinks = new HashMap<>();
        Map<String, List<String>> linkConnGraph = new HashMap<>();
        Map<String, String> nodeType = new HashMap<>();
        Pattern linkPat = Pattern.compile("<link id=\"([^\"]+)\" from_node=\"([^\"]+)\" to_node=\"([^\"]+)\"");
        Pattern nodePat = Pattern.compile("<node id=\"([^\"]+)\" type=\"([^\"]+)\"");
        Pattern connPat = Pattern.compile("<connection\\s[^>]*from_link=\"(\\d+)\"[^>]*to_link=\"(\\d+)\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8)) {
            char[] buf = new char[1 << 22];
            String carry = "";
            int n;
            while ((n = reader.read(buf)) > 0) {
                String chunk = carry + new String(buf, 0, n);
                Matcher lm = linkPat.matcher(chunk);
                while (lm.find()) {
                    String lid = lm.group(1), f = lm.group(2), t = lm.group(3);
                    nodeOutLinks.computeIfAbsent(f, k -> new ArrayList<>()).add(lid);
                    nodeInLinks.computeIfAbsent(t, k -> new ArrayList<>()).add(lid);
                }
                Matcher nm = nodePat.matcher(chunk);
                while (nm.find()) {
                    nodeType.put(nm.group(1), nm.group(2));
                }
                Matcher cm = connPat.matcher(chunk);
                while (cm.find()) {
                    linkConnGraph.computeIfAbsent(cm.group(1), k -> new ArrayList<>()).add(cm.group(2));
                }
                carry = chunk.length() > 512 ? chunk.substring(chunk.length() - 512) : chunk;
            }
        }

        String odContent = Files.readString(odMatrixXml, StandardCharsets.UTF_8);
        Map<String, Set<String>> reachedLinksCache = new HashMap<>();
        int total = 0, removed = 0, removedNotTerminal = 0;
        StringBuilder out = new StringBuilder(odContent.length());
        Matcher dm = Pattern.compile("<demand\\b[^>]*?/>").matcher(odContent);
        int last = 0;
        while (dm.find()) {
            out.append(odContent, last, dm.start());
            last = dm.end();
            String tag = dm.group();
            total++;
            Matcher sm = Pattern.compile("\\bsource=\"([^\"]+)\"").matcher(tag);
            Matcher km = Pattern.compile("\\bsink=\"([^\"]+)\"").matcher(tag);
            String src = sm.find() ? sm.group(1) : null;
            String snk = km.find() ? km.group(1) : null;
            boolean bothTerminal = "terminal".equals(nodeType.get(src)) && "terminal".equals(nodeType.get(snk));
            boolean reachable = bothTerminal && src != null && snk != null
                    && isReachableViaConnections(nodeOutLinks, nodeInLinks, linkConnGraph, reachedLinksCache, src, snk);
            if (reachable) {
                out.append(tag);
            } else {
                removed++;
                if (!bothTerminal) removedNotTerminal++;
            }
        }
        out.append(odContent, last, odContent.length());

        if (removed > 0) {
            Files.writeString(odMatrixXml, out.toString(), StandardCharsets.UTF_8);
            log.warn("[NextSimRunner] 도달 불가능/터미널 아님으로 OD 수요 {}/{} 건 제거 " +
                    "(터미널 아님 {}건 포함) — route-generator가 빈 경로로 조용히 처리해 nextsim " +
                    "크래시로 이어지던 문제 사전 차단", removed, total, removedNotTerminal);
        }
    }

    private static boolean isReachableViaConnections(Map<String, List<String>> nodeOutLinks,
                                                       Map<String, List<String>> nodeInLinks,
                                                       Map<String, List<String>> linkConnGraph,
                                                       Map<String, Set<String>> reachedLinksCache,
                                                       String sourceNode, String sinkNode) {
        Set<String> reached = reachedLinksCache.computeIfAbsent(sourceNode,
                s -> bfsLinks(linkConnGraph, nodeOutLinks.getOrDefault(s, List.of())));
        for (String inLink : nodeInLinks.getOrDefault(sinkNode, List.of())) {
            if (reached.contains(inLink)) return true;
        }
        return false;
    }

    private static Set<String> bfsLinks(Map<String, List<String>> linkConnGraph, List<String> startLinks) {
        Set<String> visited = new HashSet<>(startLinks);
        Deque<String> stack = new ArrayDeque<>(startLinks);
        while (!stack.isEmpty()) {
            String cur = stack.pop();
            for (String next : linkConnGraph.getOrDefault(cur, List.of())) {
                if (visited.add(next)) stack.push(next);
            }
        }
        return visited;
    }

    /** 여는 태그 이후부터 종료 태그(포함)까지 읽기 — 노드 블록 수집용 */
    private static String readUntilCloseTag(java.io.Reader reader, String closeTag) throws IOException {
        StringBuilder sb = new StringBuilder(2048);
        int matched = 0;
        int c;
        while ((c = reader.read()) >= 0) {
            char ch = (char) c;
            sb.append(ch);
            matched = (ch == closeTag.charAt(matched)) ? matched + 1
                    : (ch == closeTag.charAt(0) ? 1 : 0);
            if (matched == closeTag.length()) return sb.toString();
        }
        throw new IOException("network.xml 이 " + closeTag + " 없이 끝났습니다");
    }

    private static final Pattern PORT_NO_DIRECTION = Pattern.compile("(<port (?![^>]*direction=)[^>]*?)(/?>)");
    private static final Pattern PORT_IN = Pattern.compile("<port type=\"in\" link_id=\"(\\d+)\"");
    private static final Pattern PORT_OUT = Pattern.compile("<port type=\"out\" link_id=\"(\\d+)\"");
    private static final Pattern CONN_FROM = Pattern.compile("<connection [^>]*from_link=\"(\\d+)\"");
    private static final Pattern CONN_TO = Pattern.compile("<connection [^>]*to_link=\"(\\d+)\"");
    private static final Pattern CONN_ID = Pattern.compile("<connection id=\"(\\d+)\"");
    private static final Pattern NODE_CENTER = Pattern.compile("center=\"([-\\d.]+) ([-\\d.]+)\"");

    /**
     * 통과 노드 블록에서 커넥션이 누락된 in/out 링크에 직진(0→0) 커넥션을 채운다.
     * 채운 게 없으면 원본 블록 그대로 반환.
     */
    private static String fillMissingConnections(String block) {
        Set<String> connFrom = collect(CONN_FROM, block);
        Set<String> connTo = collect(CONN_TO, block);
        List<String> inLinks = collectList(PORT_IN, block);
        List<String> outLinks = collectList(PORT_OUT, block);
        if (inLinks.isEmpty() || outLinks.isEmpty()) return block;

        Matcher cm = NODE_CENTER.matcher(block);
        String cx = "0", cy = "0";
        if (cm.find()) { cx = cm.group(1); cy = cm.group(2); }
        int nextId = 0;
        Matcher im = CONN_ID.matcher(block);
        while (im.find()) nextId = Math.max(nextId, Integer.parseInt(im.group(1)) + 1);

        StringBuilder add = new StringBuilder();
        for (String il : inLinks) {
            if (!connFrom.contains(il)) {
                add.append(connXml(nextId++, il, outLinks.get(0), cx, cy));
            }
        }
        for (String ol : outLinks) {
            if (!connTo.contains(ol)) {
                add.append(connXml(nextId++, inLinks.get(0), ol, cx, cy));
            }
        }
        if (add.length() == 0) return block;

        int close = block.lastIndexOf("</node>");
        String out = block.substring(0, close) + add + "</node>";
        int total = countMatches(CONN_ID, out);
        return out.replaceFirst("num_connection=\"\\d+\"", "num_connection=\"" + total + "\"");
    }

    private static String connXml(int id, String fromLink, String toLink, String cx, String cy) {
        // shape 두 점이 노드 center 로 완전히 동일하면 length="1.0" 과 불일치하는 축퇴(0길이)
        // 지오메트리가 된다(KtdbNetworkConverter 등에서 실측된 것과 동일 문제) — 이 보완 커넥션은
        // 실제 링크 지오메트리 조회 없이 텍스트 블록만으로 생성되므로 정확한 진행방향 대신
        // 임의의 로컬 +x 방향으로 length(1.0m)만큼 떨어진 두 번째 점을 사용해 실제 길이를 갖는 shape로 만든다.
        double cxVal, cyVal;
        try { cxVal = Double.parseDouble(cx); cyVal = Double.parseDouble(cy); }
        catch (NumberFormatException e) { cxVal = 0; cyVal = 0; }
        String cx2 = String.valueOf(cxVal + 1.0);
        return "<connection id=\"" + id + "\" from_link=\"" + fromLink + "\" from_lane=\"0\" to_link=\"" + toLink
                + "\" to_lane=\"0\" turning=\"S\" length=\"1.0\" width=\"3.0\" ff_spd=\"30.0\" shape=\""
                + cx + "," + cy + " " + cx2 + "," + cy + "\"/>";
    }

    private static Set<String> collect(Pattern p, String s) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = p.matcher(s);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    private static List<String> collectList(Pattern p, String s) {
        List<String> out = new java.util.ArrayList<>();
        Matcher m = p.matcher(s);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    private static int countMatches(Pattern p, String s) {
        int n = 0;
        Matcher m = p.matcher(s);
        while (m.find()) n++;
        return n;
    }

    /** passenger.xml 에 실제 &lt;demand&gt; 항목이 하나라도 있는지 (없으면 빈 스텁 — 기본값) */
    private static boolean hasPassengerDemand(Path passengerXml) throws IOException {
        if (!Files.exists(passengerXml)) return false;
        String xml = Files.readString(passengerXml, StandardCharsets.UTF_8);
        return Pattern.compile("<demand\\b").matcher(xml).find();
    }

    /** roadStation.xml + railStation.xml 의 정류장/역 총합 (MAX_SAFE_PT_STATION_COUNT_WITH_DEMAND 사전 검사용) */
    private static int countPtStations(Path roadStationXml, Path railStationXml) throws IOException {
        int count = 0;
        if (Files.exists(roadStationXml)) {
            count += countMatches(Pattern.compile("<station\\b"), Files.readString(roadStationXml, StandardCharsets.UTF_8));
        }
        if (Files.exists(railStationXml)) {
            count += countMatches(Pattern.compile("<railStation\\b"), Files.readString(railStationXml, StandardCharsets.UTF_8));
        }
        return count;
    }

    /** odmatrix.xml 에 flow>0 인 수요가 하나라도 있는지 검증 (없으면 실행 무의미) */
    private static void requirePositiveDemand(Path odmatrixXml) throws IOException {
        String xml = Files.readString(odmatrixXml, StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("\\bflow=\"([^\"]*)\"").matcher(xml);
        while (m.find()) {
            try {
                if (Double.parseDouble(m.group(1)) > 0) return;
            } catch (NumberFormatException ignored) {}
        }
        throw new IOException("odmatrix.xml 에 수요(flow>0)가 없습니다 — OD 매트릭스 메뉴에서 수요를 입력하세요.");
    }

    /** odmatrix.xml 의 source/sink 노드 id 집합 (가지치기 유지 대상) */
    private static Set<String> extractOdNodeIds(Path odmatrixXml) throws IOException {
        Set<String> ids = new LinkedHashSet<>();
        String xml = Files.readString(odmatrixXml, StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("\\b(?:source|sink)=\"([^\"]+)\"").matcher(xml);
        while (m.find()) ids.add(m.group(1));
        return ids;
    }

    /**
     * 버스 노선(roadPTline.xml, "버스 노선" 편집 화면 — getDefault만 실제 시뮬레이션에 쓰임,
     * weekday/weekend 변형은 NextSimRunner가 아직 참조 안 함)의 실제 경로(node.seq) 시작/끝
     * 노드 id 집합 — 가지치기가 잘못 garage로 바꾸면 안 되는 대상.
     *
     * <p>⚠️ node.seq(경로가 실제로 지나는 노드 체인)에서만 추출한다 — station.seq(정류장 id,
     * 네트워크 노드 id와 다른 별도 네임스페이스)나 garage.seq(진짜 차고지, 원래도 이미
     * type="garage"라 가지치기가 손대지 않고 앞으로도 손대면 안 됨)는 절대 포함하지 않는다.
     * 조회 실패(노선 없음 등)는 조용히 빈 집합으로 — 이 메서드는 순수 보조 최적화라 실패해도
     * 시뮬레이션 자체를 막으면 안 된다.
     */
    private Set<String> extractBusRouteEndpointNodeIds(String versionId) {
        Set<String> ids = new LinkedHashSet<>();
        try {
            var lines = busPtLineService.getDefault(versionId);
            if (lines == null || lines.getLines() == null) return ids;
            for (var line : lines.getLines()) {
                String nodeSeq = line.getNode() != null ? line.getNode().getSeq() : null;
                if (nodeSeq == null || nodeSeq.isBlank()) continue;
                String[] nodes = nodeSeq.trim().split("\\s+");
                ids.add(nodes[0]);
                ids.add(nodes[nodes.length - 1]);
            }
        } catch (Exception e) {
            log.warn("[NextSimRunner] {} 버스 노선 종점 조회 실패(가지치기 보호 없이 진행): {}", versionId, e.getMessage());
        }
        return ids;
    }

    /** network.xml 에서 링크 id 추출 — 수백 MB 파일 대비 청크 스트림 스캔 (DOM 로드 금지) */
    private Set<String> extractLinkIds(Path networkXml) throws IOException {
        Set<String> ids = new LinkedHashSet<>();
        Pattern p = Pattern.compile("<link\\s+id=\"([^\"]+)\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8)) {
            char[] buf = new char[1 << 22]; // 4MB
            String carry = "";
            int n;
            while ((n = reader.read(buf)) > 0) {
                String chunk = carry + new String(buf, 0, n);
                Matcher m = p.matcher(chunk);
                while (m.find()) ids.add(m.group(1));
                // 경계에 걸린 태그 보존 (태그+id 최대 길이 여유)
                carry = chunk.length() > 256 ? chunk.substring(chunk.length() - 256) : chunk;
            }
        }
        if (ids.isEmpty()) throw new IOException("network.xml 에서 링크를 찾지 못했습니다");
        return ids;
    }

    // ─────────────────────────── 터미널 크래시 자동 복구 (route-generator + nextsim 공용) ─────

    /** 크래시 복구에 쓸 수 있는 총 재시도 예산 (부천 규모 — 터미널 수백 개 대비 여유 확보) */
    private static final int MAX_CRASH_RECOVERY_ATTEMPTS = 600;

    /**
     * doctest FAILURE 시그니처 이후 무한 행(hang)하는 크래시로 확인된 경우(실측: `std::out_of_range`
     * — 특정 터미널 노드(들)가 원인, 구조는 정상인데 **문제 노드 단독으로는 성공하고 다른
     * 터미널과 동시에 존재할 때만 크래시하는 경우도, 노드 단독으로도 크래시하는 경우도 실측됨**.
     * 배포판 바이너리라 소스 레벨 근본 수정 불가) 자동 복구를 시도한다.
     *
     * <p><b>전략 — 재귀 이분탐색으로 최대 안전 부분집합 탐색</b>: 터미널이 수십~수백 개 규모일 때
     * 하나씩 선형으로 테스트하면 시도 횟수가 터미널 수에 비례해 비싸진다(실측 — scenario1_2 4개
     * 중 하나씩 제거로는 아예 못 풀림: 문제 노드가 2개 이상인 경우 선형 제거로는 해결 불가).
     * 절반씩 쪼개 각 절반을 독립적으로 테스트 → 성공한 절반은 그대로 안전 확정(문제 노드가
     * 드물면 대부분의 절반이 한 번에 통과해 O(log N) 수준으로 저렴), 실패한 절반만 재귀로 더
     * 쪼갠다(크기 1까지 내려가면 그 노드가 원인). 양쪽 절반의 안전 부분집합을 합쳐 재테스트해
     * 교차 상호작용도 검증하고, 합친 것도 크래시하면 한쪽을 기준으로 다른 쪽 원소를 하나씩
     * 병합(범위가 절반 크기로 줄어 저렴)해 상호작용 원인만 걸러낸다.
     *
     * <p>route-generator("RouteGenerator")와 nextsim("Simulation") 양쪽에서 동일한 크래시
     * 시그니처가 실측 확인됨(전자를 통과해도 후자의 "Initializing Terminals/Garage" 초기화
     * 단계에서 별도 재현될 수 있음) — 두 단계 모두 이 래퍼로 감싼다.
     *
     * <p>안전 집합이 끝내 비거나 예산({@link #MAX_CRASH_RECOVERY_ATTEMPTS}) 소진 시 그 시점까지
     * 확정된 부분집합으로 진행하며, 아예 비면 최초 크래시로 실패한다.
     */
    private String runStageWithCrashRecovery(
            String versionId, Path workDir, Path networkDir, String binary, String testCase,
            Consumer<String> progress) throws Exception {
        Path networkXml = networkDir.resolve("network.xml");
        try {
            return runStage(versionId, workDir, binary, testCase, progress);
        } catch (TerminalNodeCrashException first) {
            // 0단계: 버스 노선 절연 재시도 — 문서화된 NextSim 바이너리 결함(NEXTSIM_DATA_STRUCTURE.md
            // #roadptline-xml: 터미널↔터미널의 유효한 노선이라도 시뮬 사이클 직전 크래시)이 원인이면
            // 아래 터미널 이분탐색은 어떤 조합으로도 절대 성공하지 못하고 예산(MAX_CRASH_RECOVERY_ATTEMPTS)만
            // 전부 태운다(실측: scenario2_1, 노선 1개 존재만으로 시도당 ~1분씩 무한 헛탐색). 노선이
            // 있으면 노선만 비운 채 1회 재시도해 원인을 절연한다 — 성공하면 원인은 노선(바이너리 결함)으로
            // 확정이고 이번 실행은 버스 노선 제외로 진행, 실패하면 원상 복구 후 기존 이분탐색으로 넘어간다.
            String ptIsolated = tryPtIsolationRetry(versionId, workDir, networkDir, binary, testCase, progress);
            if (ptIsolated != null) return ptIsolated;

            List<String> candidates = extractTerminalIds(networkXml);
            log.warn("[NextSimRunner] {} {} 크래시 — 터미널 {}개 중 이분탐색으로 안전 부분집합 탐색",
                    versionId, testCase, candidates.size());

            // odmatrix.xml pristine 스냅샷 — 이분탐색 도중 어떤 후보를 garage 로 돌려도
            // 그 노드를 source/sink 로 참조하던 수요가 "고아 참조"로 남아 InitializeVehicleDemand()
            // 에서 별개의 std::out_of_range 크래시를 유발한다(실측 확인 — network.xml 만 바꾸고
            // odmatrix.xml 은 그대로 두면, 진짜 문제 노드가 1개뿐이어도 그 노드를 참조하는 수요가
            // 조금이라도 남는 거의 모든 부분집합이 이 고아 참조 크래시로 오염돼 이분탐색이
            // 무의미해진다). 매 시도마다 이 pristine 기준으로 다시 써서 active 집합에
            // 대응하는 odmatrix 만 남긴다(누적 삭제 아님 — activateOnly 와 동일한 전량 재작성 방식).
            Path odMatrixXml = networkDir.resolve("odmatrix.xml");
            String odMatrixPristine = Files.readString(odMatrixXml, StandardCharsets.UTF_8);

            int[] attemptsLeft = { MAX_CRASH_RECOVERY_ATTEMPTS };
            String[] lastGoodLog = { null };
            CrashRecoveryCtx ctx = new CrashRecoveryCtx(
                    versionId, workDir, networkXml, odMatrixXml, odMatrixPristine,
                    binary, testCase, progress, candidates, attemptsLeft, lastGoodLog);
            List<String> safeSet = resolveChunk(ctx, candidates);

            if (!safeSet.isEmpty()) {
                // 재귀 탐색 도중 network.xml 의 노드 type 은 매 시도마다 정확히 복원되지만
                // (activateOnly), Route.json 등 스테이지 산출물은 그 복원으로 되살아나지
                // 않는다 — 실측: 탐색 마지막 실제 호출이 (다른 조합의) 실패 시도였던 경우
                // route-generator 가 "Removed previous json" 후 크래시해 Route.json 이
                // 비거나 잘린 채로 남음. 반환 직전 확정된 safeSet 으로 한 번 더 실행해
                // 산출물을 safeSet 과 확실히 일치시킨다(이미 검증된 조합이라 실패할 수 없음).
                if (!tryActivate(ctx, safeSet)) {
                    throw new RuntimeException(testCase + " 최종 확인 실행이 실패했습니다 " +
                            "(이미 성공 검증된 안전 부분집합 " + safeSet.size() + "개) — 재시도해주세요.");
                }
                List<String> excluded = new ArrayList<>(candidates);
                excluded.removeAll(safeSet);
                log.warn("[NextSimRunner] {} {} — 안전 부분집합 {}/{} 개로 진행(시도 {}회 소모) — " +
                        "제외된 노드({})는 NextSim 바이너리 결함 우회(해당 노드를 참조하는 OD 수요는 무시됨)",
                        versionId, testCase, safeSet.size(), candidates.size(),
                        MAX_CRASH_RECOVERY_ATTEMPTS - attemptsLeft[0], excluded);
                return lastGoodLog[0];
            }
            throw new RuntimeException(
                    testCase + " 가 반복적으로 크래시했습니다 (터미널 " + candidates.size() + "개 중 어떤 조합으로도 성공 못 함) — " +
                    "NextSim 바이너리 결함으로 추정됩니다. OD 매트릭스의 source/sink 조합을 바꿔보세요.\n" +
                    tail(first.getMessage(), 800));
        }
    }

    /**
     * 버스 노선 절연 재시도 — 스테이징된 roadPTline.xml에 실제 노선이 있으면 노선만 비우고
     * (PTRoute.json도 있으면 빈 스텁으로) 같은 스테이지를 1회 재실행한다.
     *
     * @return 성공하면 그 실행 로그(이번 실행은 버스 노선 제외로 계속 진행됨), 노선이 없거나
     *         비워도 여전히 크래시하면(원상 복구 후) null — 호출부는 기존 터미널 이분탐색으로 진행.
     */
    private String tryPtIsolationRetry(
            String versionId, Path workDir, Path networkDir, String binary, String testCase,
            Consumer<String> progress) throws Exception {
        Path roadPtLine = networkDir.resolve("roadPTline.xml");
        String original;
        try {
            if (!Files.exists(roadPtLine)) return null;
            original = Files.readString(roadPtLine, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
        if (!original.contains("<Line ")) return null; // 노선 자체가 없음 — 절연할 게 없다

        Path ptRouteJson = networkDir.resolve("PTRoute.json");
        String ptRouteOriginal = null;
        try {
            if (Files.exists(ptRouteJson)) ptRouteOriginal = Files.readString(ptRouteJson, StandardCharsets.UTF_8);
        } catch (IOException ignored) {}

        // NOTE: SimulationController.classifyStep()이 "{testCase} 크래시 복구" 부분문자열로 매칭 — 문구 유지.
        progress.accept(testCase + " 크래시 복구 — 버스 노선 절연 재시도(노선 제외 1회 실행)");
        try {
            Files.writeString(roadPtLine, xml("<Lines mode=\"Bus\">\n</Lines>"), StandardCharsets.UTF_8);
            if (ptRouteOriginal != null) {
                Files.writeString(ptRouteJson, "{\n    \"Route\": []\n}", StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            log.warn("[NextSimRunner] {} {} 버스 노선 절연 파일 쓰기 실패 — 이분탐색으로 진행: {}",
                    versionId, testCase, e.getMessage());
            return null;
        }
        try {
            String output = runStage(versionId, workDir, binary, testCase, progress);
            log.warn("[NextSimRunner] {} {} — 버스 노선 절연으로 성공: 크래시 원인이 roadPTline.xml의 " +
                    "노선(NextSim 바이너리 결함 — NEXTSIM_DATA_STRUCTURE.md #roadptline-xml)으로 확인됨. " +
                    "이번 실행은 버스 노선 제외로 진행됨 — 터미널 이분탐색 예산 소모 없음", versionId, testCase);
            return output;
        } catch (TerminalNodeCrashException stillCrashes) {
            // 노선이 원인이 아님 — 원상 복구하고 기존 이분탐색으로
            try {
                Files.writeString(roadPtLine, original, StandardCharsets.UTF_8);
                if (ptRouteOriginal != null) Files.writeString(ptRouteJson, ptRouteOriginal, StandardCharsets.UTF_8);
            } catch (IOException e) {
                log.warn("[NextSimRunner] {} {} 버스 노선 절연 원상복구 실패(무시): {}", versionId, testCase, e.getMessage());
            }
            log.info("[NextSimRunner] {} {} — 버스 노선을 비워도 크래시 — 노선 원인 아님, 터미널 이분탐색으로 진행",
                    versionId, testCase);
            return null;
        }
    }

    /** 크래시 복구 재귀 호출에 공통으로 필요한 컨텍스트 묶음 */
    private record CrashRecoveryCtx(
            String versionId, Path workDir, Path networkXml, Path odMatrixXml, String odMatrixPristine,
            String binary, String testCase,
            Consumer<String> progress, List<String> allCandidates, int[] attemptsLeft, String[] lastGoodLog) {}

    /**
     * chunk 를 단독 활성화했을 때 크래시한다는 전제(호출부 보장) 하에 재귀 이분탐색으로
     * chunk 의 최대 안전 부분집합을 반환한다.
     */
    private List<String> resolveChunk(CrashRecoveryCtx ctx, List<String> chunk) throws Exception {
        if (chunk.size() <= 1) return List.of(); // 단독도 크래시 — 이 노드(들)가 원인
        int mid = chunk.size() / 2;
        List<String> left = chunk.subList(0, mid);
        List<String> right = chunk.subList(mid, chunk.size());

        List<String> safeLeft = testChunkOrRecurse(ctx, left);
        List<String> safeRight = testChunkOrRecurse(ctx, right);
        if (safeLeft.isEmpty()) return safeRight;
        if (safeRight.isEmpty()) return safeLeft;
        if (ctx.attemptsLeft()[0] <= 0) return safeLeft;

        List<String> merged = new ArrayList<>(safeLeft);
        merged.addAll(safeRight);
        ctx.progress().accept(ctx.testCase() + " 크래시 복구 — 부분집합 병합 시도 (" + merged.size() + "개)");
        if (tryActivate(ctx, merged)) return merged;

        // 교차 상호작용 — safeLeft(이미 안전 확정) 기준으로 safeRight 원소를 하나씩 병합
        return mergeOneByOne(ctx, safeLeft, safeRight);
    }

    /** chunk 를 단독 테스트 — 성공하면 그대로, 크래시하면 재귀 이분탐색(예산 소진 시 보수적으로 빈 집합) */
    private List<String> testChunkOrRecurse(CrashRecoveryCtx ctx, List<String> chunk) throws Exception {
        if (chunk.isEmpty() || ctx.attemptsLeft()[0] <= 0) return List.of();
        ctx.progress().accept(ctx.testCase() + " 크래시 복구 — 구간 테스트 (" + chunk.size() + "개)");
        if (tryActivate(ctx, chunk)) return chunk;
        return resolveChunk(ctx, chunk);
    }

    /** safeBase(이미 안전 확정) 에 candidates 를 하나씩 병합 시도 — 실패한 노드는 제외하고 계속 */
    private List<String> mergeOneByOne(CrashRecoveryCtx ctx, List<String> safeBase, List<String> candidates) throws Exception {
        List<String> merged = new ArrayList<>(safeBase);
        for (String candidate : candidates) {
            if (ctx.attemptsLeft()[0] <= 0) break;
            List<String> trial = new ArrayList<>(merged);
            trial.add(candidate);
            ctx.progress().accept(ctx.testCase() + " 크래시 복구 — 노드 " + candidate + " 병합 시도");
            if (tryActivate(ctx, trial)) {
                merged = trial;
            } else {
                // 실패 — 파일만 복원(재실행 없음, 예산 안 씀)
                activateOnly(ctx.networkXml(), ctx.allCandidates(), merged);
                filterOdMatrixForActive(ctx.odMatrixXml(), ctx.odMatrixPristine(), ctx.allCandidates(), merged);
            }
        }
        return merged;
    }

    /**
     * allCandidates 중 active 에 속한 것만 terminal, 나머지는 garage 로 맞추고 실행 —
     * 성공하면 true(lastGoodLog 갱신), 크래시하면 false. 예산을 1 소모한다.
     * (파일 상태만 맞추고 재실행하지 않는 호출은 이 메서드를 거치지 않음 — mergeOneByOne 의
     * 복원 참고)
     */
    private boolean tryActivate(CrashRecoveryCtx ctx, List<String> active) throws Exception {
        activateOnly(ctx.networkXml(), ctx.allCandidates(), active);
        filterOdMatrixForActive(ctx.odMatrixXml(), ctx.odMatrixPristine(), ctx.allCandidates(), active);
        ctx.attemptsLeft()[0]--;
        try {
            ctx.lastGoodLog()[0] = runStage(ctx.versionId(), ctx.workDir(), ctx.binary(), ctx.testCase(), ctx.progress());
            return true;
        } catch (TerminalNodeCrashException e) {
            return false;
        }
    }

    /** allCandidates 중 active 에 속한 노드만 terminal, 나머지는 garage — 한 번의 스트림 패스로 일괄 반영 */
    private static void activateOnly(Path networkXml, List<String> allCandidates, List<String> active) throws IOException {
        Set<String> activeSet = new HashSet<>(active);
        Map<String, String> updates = new java.util.HashMap<>();
        for (String c : allCandidates) updates.put(c, activeSet.contains(c) ? "terminal" : "garage");
        setNodeTypes(networkXml, updates);
    }

    private static final Pattern OD_DEMAND = Pattern.compile("<demand\\b[^>]*?/>");
    private static final Pattern OD_SOURCE = Pattern.compile("\\bsource=\"([^\"]+)\"");
    private static final Pattern OD_SINK = Pattern.compile("\\bsink=\"([^\"]+)\"");

    /**
     * pristine(전체 후보가 terminal 이던 시점의 원본 odmatrix.xml) 기준으로, allCandidates 중
     * active 에 없는(=이번 시도에서 garage 로 전환된) 노드를 source 또는 sink 로 참조하는
     * 수요를 제거해 스테이징 odmatrix.xml 을 다시 쓴다.
     *
     * <p>activateOnly 로 노드를 garage 로 돌려도 odmatrix.xml 을 그대로 두면, 그 노드를 참조하던
     * 수요가 고아 참조로 남아 InitializeVehicleDemand() 에서 activateOnly 가 격리하려던 것과
     * 동일한 시그니처의 std::out_of_range 크래시를 별도로 유발한다(실측 확인 — 진짜 문제 노드가
     * 단 1개뿐이어도, 이 필터링 없이는 그 노드를 참조하는 수요가 조금이라도 살아있는 거의 모든
     * 부분집합이 "고아 참조" 크래시로 오염되어 이분탐색이 무의미해진다). 매 시도마다 pristine에서
     * 새로 필터링한다(activateOnly 와 동일하게 누적 아닌 전량 재작성 — 이전 시도의 삭제가 다음
     * 시도에 남지 않음).
     */
    static void filterOdMatrixForActive(
            Path odMatrixXml, String pristine, List<String> allCandidates, List<String> active) throws IOException {
        Set<String> garaged = new HashSet<>(allCandidates);
        garaged.removeAll(active);
        if (garaged.isEmpty()) {
            Files.writeString(odMatrixXml, pristine, StandardCharsets.UTF_8);
            return;
        }
        StringBuilder out = new StringBuilder(pristine.length());
        Matcher dm = OD_DEMAND.matcher(pristine);
        int last = 0;
        while (dm.find()) {
            out.append(pristine, last, dm.start());
            last = dm.end();
            String tag = dm.group();
            Matcher sm = OD_SOURCE.matcher(tag);
            Matcher km = OD_SINK.matcher(tag);
            String src = sm.find() ? sm.group(1) : null;
            String snk = km.find() ? km.group(1) : null;
            boolean drop = (src != null && garaged.contains(src)) || (snk != null && garaged.contains(snk));
            if (!drop) out.append(tag);
        }
        out.append(pristine, last, pristine.length());
        Files.writeString(odMatrixXml, out.toString(), StandardCharsets.UTF_8);
    }

    /**
     * route-generator/nextsim 공용 "이 조합은 안전하다고 증명 못 함" 표식 — 이분탐색이
     * 크래시와 동일하게 취급해 더 작은 부분집합으로 재귀한다. 두 경우에 던짐:
     * 1) doctest FAILURE 시그니처 감지 후 행 방지를 위해 즉시 종료(실제 크래시)
     * 2) 개별 실행이 timeoutSeconds 를 초과(실측: 대규모 네트워크에서 이분탐색 도중
     *    "성공하는" 부분집합 하나의 전체 시뮬레이션 자체가 타임아웃보다 오래 걸릴 수 있음 —
     *    이걸 일반 예외로 던지면 이분탐색 전체가 죽어버려 그때까지의 탐색 진행이 버려짐)
     */
    private static class TerminalNodeCrashException extends RuntimeException {
        TerminalNodeCrashException(String output) { super(output); }
    }

    /** network.xml 의 현재 terminal 노드 id 목록 (크래시 복구 후보) — 수백 MB 대비 청크 스캔 */
    private static List<String> extractTerminalIds(Path networkXml) throws IOException {
        List<String> ids = new ArrayList<>();
        Pattern p = Pattern.compile("<node id=\"([^\"]+)\" type=\"terminal\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8)) {
            char[] buf = new char[1 << 22];
            String carry = "";
            int n;
            while ((n = reader.read(buf)) > 0) {
                String chunk = carry + new String(buf, 0, n);
                Matcher m = p.matcher(chunk);
                while (m.find()) ids.add(m.group(1));
                carry = chunk.length() > 256 ? chunk.substring(chunk.length() - 256) : chunk;
            }
        }
        return ids;
    }

    /**
     * network.xml 에서 여러 노드의 type 속성을 한 번의 스트림 패스로 일괄 교체 (태그 단위, 대용량
     * 대응). 크래시 복구가 매 시도마다 노드 하나씩 별도 패스로 파일을 다시 쓰면 후보가
     * 수백 개일 때 비용이 커져 — 활성화할 부분집합 전체를 한 번에 반영한다.
     */
    private static void setNodeTypes(Path networkXml, Map<String, String> typeById) throws IOException {
        if (typeById.isEmpty()) return;
        Path tmp = networkXml.resolveSibling(networkXml.getFileName() + ".toggle");
        Pattern idAttr = Pattern.compile("id=\"([^\"]+)\"");
        try (var reader = Files.newBufferedReader(networkXml, StandardCharsets.UTF_8);
             var writer = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            StringBuilder tag = null;
            int c;
            while ((c = reader.read()) >= 0) {
                char ch = (char) c;
                if (tag == null) {
                    if (ch == '<') { tag = new StringBuilder("<"); } else { writer.write(ch); }
                    continue;
                }
                tag.append(ch);
                if (ch != '>') continue;
                String t = tag.toString();
                tag = null;
                if (t.startsWith("<node id=\"")) {
                    Matcher m = idAttr.matcher(t);
                    String newType = m.find() ? typeById.get(m.group(1)) : null;
                    if (newType != null) {
                        int typeIdx = t.indexOf("type=\"");
                        if (typeIdx >= 0) {
                            int typeStart = typeIdx + 6;
                            int typeEnd = t.indexOf('"', typeStart);
                            t = t.substring(0, typeStart) + newType + t.substring(typeEnd);
                        }
                    }
                }
                writer.write(t);
            }
            if (tag != null) writer.write(tag.toString());
        }
        Files.move(tmp, networkXml, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    // ─────────────────────────── 단계 실행 (docker / native) ───────────────────────────

    /**
     * 배포판 바이너리 1개(route-generator/nextsim)를 실행 모드에 따라 수행.
     *
     * <p>NextSimIO 는 **cwd 에서 상위로 올라가며** SimulationInput 을 탐색한다
     * (바이너리 위치 기준 아님 — docker 실행에서 cwd=/ns/Captain/build/bin,
     * 입력=/ns/SimulationInput 으로 실측 확인). 따라서
     * - docker: 워크스페이스를 /ns 에 마운트, cwd=/ns/Captain/build/bin
     * - native: cwd=워크스페이스 루트, 바이너리는 배포판 절대경로로 exec
     *   (cwd/SimulationInput 이 즉시 발견되고, 출력도 cwd/SimulationOutput 에 생성)
     */
    private String runStage(String versionId, Path workDir, String binary, String testCase, Consumer<String> progress) throws Exception {
        boolean nativeMode = "native".equalsIgnoreCase(executionMode);
        String container = null;
        List<String> cmd;
        if (nativeMode) {
            Path bin = Path.of(nextsimHome, "Captain", "build", "bin", binary).toAbsolutePath();
            cmd = List.of(bin.toString(), "-tc=" + testCase);
        } else {
            container = "nextsim_" + sanitize(versionId) + "_" + System.currentTimeMillis();
            cmd = List.of(
                    "docker", "run", "--rm",
                    "--name", container, // 취소 시 docker rm -f 대상 (CLI 만 죽이면 컨테이너가 계속 돎)
                    "--platform", dockerPlatform,
                    "-v", Path.of(nextsimHome, "Captain").toAbsolutePath() + ":/ns/Captain:ro",
                    "-v", workDir.resolve("SimulationInput").toAbsolutePath() + ":/ns/SimulationInput",
                    "-v", workDir.resolve("SimulationOutput").toAbsolutePath() + ":/ns/SimulationOutput",
                    "-w", "/ns/Captain/build/bin",
                    dockerImage,
                    "bash", "-lc", "./" + binary + " -tc=\"" + testCase + "\""
            );
        }
        log.info("[NextSimRunner] {} 실행: {}", nativeMode ? "native" : "docker", String.join(" ", cmd));

        ProcessBuilder pb = new ProcessBuilder(cmd);
        if (nativeMode) pb.directory(workDir.toFile()); // cwd=워크스페이스 루트 → 상향 탐색이 입력 발견
        pb.redirectErrorStream(true);
        Process process;
        try {
            process = pb.start();
        } catch (IOException e) {
            throw new RuntimeException(nativeMode
                    ? "NextSim 바이너리 실행 실패 — native 모드는 Linux x86_64 전용입니다 " +
                      "(mac 개발기는 nextsim.execution-mode=docker 사용): " + e.getMessage()
                    : "Docker 실행 실패 — Docker 데몬이 실행 중인지 확인하세요: " + e.getMessage(), e);
        }
        activeProcess = process;
        activeContainer = container;

        // 출력 tail 유지 + 진행 로그 — 반드시 별도 스레드로.
        // 메인 스레드에서 readLine 하면 프로세스가 출력 없이 살아있는 동안 블록돼
        // waitFor(timeout) 에 도달하지 못한다 (타임아웃 무력화 — 수도권 77분 실행으로 실측).
        StringBuilder tailBuf = new StringBuilder();
        AtomicBoolean crashDetected = new AtomicBoolean(false);
        final String containerName = container;
        Thread reader = new Thread(() -> {
            try (var br = new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                long lastProgressAt = 0;
                while ((line = br.readLine()) != null) {
                    synchronized (tailBuf) {
                        tailBuf.append(line).append('\n');
                        if (tailBuf.length() > 16000) tailBuf.delete(0, tailBuf.length() - 12000);
                    }
                    // doctest FAILURE 시그니처 — 실측: 이 줄 이후 프로세스가 출력 없이 CPU 100%로
                    // 무한 행(hang)한다(doctest 가 SIGABRT 를 캐치해 리포트만 하고 정지 안 함).
                    // 타임아웃(최대 nextsim.timeout-seconds, 기본 1시간)까지 기다리지 않고 즉시 종료.
                    if (line.contains("[doctest] Status: FAILURE!") && crashDetected.compareAndSet(false, true)) {
                        log.warn("[NextSimRunner] {} 크래시 시그니처 감지 — 행 방지를 위해 즉시 종료", testCase);
                        process.destroyForcibly();
                        if (containerName != null) {
                            try { new ProcessBuilder("docker", "rm", "-f", containerName).start(); } catch (Exception ignored) {}
                        }
                    }
                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt > 3000 && !line.isBlank()) {
                        lastProgressAt = now;
                        progress.accept(line.length() > 120 ? line.substring(0, 120) : line);
                    }
                }
            } catch (IOException ignored) { /* 프로세스 종료로 스트림 닫힘 */ }
        }, "nextsim-output-reader");
        reader.setDaemon(true);
        reader.start();

        boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        if (!finished) {
            process.descendants().forEach(ProcessHandle::destroyForcibly); // native: 바이너리 자식까지
            process.destroyForcibly();
            if (container != null) {
                try { new ProcessBuilder("docker", "rm", "-f", container).start(); } catch (Exception ignored) {}
            }
            reader.join(5000);
            // TerminalNodeCrashException 으로 던진다(일반 RuntimeException 아님) — 실측: 대규모
            // 네트워크(87터미널)에서 이분탐색 도중 "성공하는" 부분집합 하나의 전체 시뮬레이션
            // 자체가 timeoutSeconds 를 넘길 수 있는데, 이걸 크래시와 구분되는 일반 예외로 던지면
            // tryActivate/runStageWithCrashRecovery 가 못 잡아서(TerminalNodeCrashException 만
            // catch) 이분탐색 전체가 그대로 죽어버리며 그때까지의 탐색 진행이 통째로 버려진다.
            // 타임아웃도 "이 조합이 예산 안에서 안전하다고 증명 못 함"으로 취급해 크래시와 동일하게
            // 재귀 탐색을 계속하는 게 맞다 — 더 작은 부분집합은 예산 안에 끝날 수 있다.
            throw new TerminalNodeCrashException("NextSim 실행 타임아웃 (" + timeoutSeconds + "초) — " +
                    "대규모 네트워크는 nextsim.timeout-seconds 상향 또는 Linux 서버 네이티브 실행을 고려하세요");
        }
        reader.join(5000); // 잔여 출력 수집
        String output;
        synchronized (tailBuf) { output = tailBuf.toString(); }
        if (cancelRequested.remove(versionId)) {
            throw new CancelledException();
        }
        if (crashDetected.get()) {
            throw new TerminalNodeCrashException(tail(output, 1200));
        }
        int exit = process.exitValue();
        if (exit != 0) {
            throw new RuntimeException("NextSim 실행 실패 (exit=" + exit + "):\n" + tail(output, 1200));
        }
        return output;
    }

    // ─────────────────────────── 유틸 ───────────────────────────

    private void copyRequired(String versionId, String fileName, Path dstDir, String missingMsg) throws IOException {
        if (!copyOptional(versionId, fileName, dstDir)) {
            throw new IOException("[" + versionId + "] " + missingMsg);
        }
    }

    /**
     * 버전 스토리지 → 스테이징 복사. 존재하면 true.
     *
     * <p>odmatrix.xml/signalTOD.xml/scenario.xml 은 관리 서비스(OdMatrixService 등)가
     * **scenario key 폴더**에 저장한다(버전별 격리 이전의 시나리오 공유 레이어).
     * versionId 폴더에 없으면 scenario key 폴더로 폴백해야 UI 로 만든 데이터를 찾는다.
     */
    private boolean copyOptional(String versionId, String fileName, Path dstDir) throws IOException {
        for (String dir : candidateDirs(versionId)) {
            String key = dir + "/" + fileName;
            if (!fileStorage.exists(key)) continue;
            byte[] bytes = fileStorage.readFile(key);
            try (InputStream in = new ByteArrayInputStream(bytes)) {
                Files.copy(in, dstDir.resolve(fileName), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
            if (!dir.equals(versionId)) {
                log.info("[NextSimRunner] {} → scenario key 폴더({})에서 사용", fileName, dir);
            }
            return true;
        }
        return false;
    }

    /** versionId 우선, scenario key 폴백 (다르면) */
    private List<String> candidateDirs(String versionId) {
        String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
        return scenarioKey.equals(versionId) ? List.of(versionId) : List.of(versionId, scenarioKey);
    }

    private static void writeIfAbsent(Path dir, String name, String content) throws IOException {
        Path f = dir.resolve(name);
        if (!Files.exists(f)) Files.writeString(f, content, StandardCharsets.UTF_8);
    }

    private static String xml(String body) {
        return "<?xml version='1.0' encoding='UTF-8'?>\n" + body + "\n";
    }

    /** NextSim이 이름으로 조회하는 6개 고정 차종 카테고리 — vehicletypes.xml 값이 이 이름과
     *  다르면 "Initializing NB/AB/TRT/Public Transit" 단계에서 매칭 실패 후 출력 없이 CPU
     *  100%로 무한 행(hang)함을 실측(2026-07-27, scenario1_1 — 이번 세션 버스/철도 작업과
     *  무관한 기존 시나리오에서도 재현되어 전역 회귀였음이 드러남). 배포판 기본값 그대로. */
    private static final List<String> REQUIRED_VEHTYPE_NAMES =
            List.of("NormalVeh", "AutonomousVeh", "Truck", "NormalBus", "AutonomousBus", "TRT");

    /** 배포판 vehicletypes.xml 템플릿의 기본값 — DB에 해당 카테고리로 매핑된 차종이 없을 때
     *  이 값을 그대로 써서 6개 카테고리가 항상 존재하도록 보장한다. */
    private static final Map<String, String> DEFAULT_VEHTYPE_BODY = Map.of(
            "NormalVeh",
            "        <veh_len dist=\"Normal\" max=\"5.5\" mean=\"5.0\" min=\"4.5\" sd=\"0.5\"/>\n" +
            "        <jamgap dist=\"Normal\" max=\"4.5\" mean=\"2.5\" min=\"2.0\" sd=\"1.0\"/>\n" +
            "        <vf dist=\"Normal\" max=\"60.0\" mean=\"50.0\" min=\"45.0\" sd=\"10.0\"/>\n" +
            "        <reaction_time dist=\"LogNormal\" max=\"3.0\" mean=\"0.8\" min=\"0.5\" sd=\"2\"/>\n" +
            "        <max_acc dist=\"Normal\" max=\"5.0\" mean=\"4.5\" min=\"4.0\" sd=\"1.1\"/>\n" +
            "        <max_dec dist=\"Normal\" max=\"5.5\" mean=\"5\" min=\"4.5\" sd=\"1.2\"/>\n" +
            "        <lc_param1 dist=\"Normal\" max=\"0.04\" mean=\"0.025\" min=\"0.01\" sd=\"0.02\"/>\n" +
            "        <lc_param2 dist=\"Normal\" max=\"0.08\" mean=\"0.055\" min=\"0.03\" sd=\"0.02\"/>\n" +
            "        <lc_sensitivity dist=\"LogNormal\" max=\"0.1\" mean=\"0.0033\" min=\"0.001\" sd=\"2.5\"/>\n",
            "AutonomousVeh",
            "        <veh_len dist=\"Normal\" max=\"5.5\" mean=\"5.0\" min=\"4.5\" sd=\"0.5\"/>\n" +
            "        <jamgap dist=\"Normal\" max=\"3.5\" mean=\"2.0\" min=\"1.0\" sd=\"0.01\"/>\n" +
            "        <vf dist=\"Normal\" max=\"125.0\" mean=\"110.0\" min=\"90.0\" sd=\"0.01\"/>\n" +
            "        <reaction_time dist=\"Normal\" max=\"3.5\" mean=\"1.7\" min=\"1.1\" sd=\"0.01\"/>\n" +
            "        <max_acc dist=\"Normal\" max=\"5.5\" mean=\"4.8\" min=\"4.5\" sd=\"0.01\"/>\n" +
            "        <max_dec dist=\"Normal\" max=\"6.5\" mean=\"5.6\" min=\"4.5\" sd=\"0.01\"/>\n" +
            "        <lc_param1 dist=\"Normal\" max=\"0.04\" mean=\"0.025\" min=\"0.01\" sd=\"0.02\"/>\n" +
            "        <lc_param2 dist=\"Normal\" max=\"0.08\" mean=\"0.055\" min=\"0.03\" sd=\"0.02\"/>\n" +
            "        <lc_sensitivity dist=\"LogNormal\" max=\"0.1\" mean=\"0.0033\" min=\"0.001\" sd=\"2.5\"/>\n",
            "Truck",
            "        <veh_len dist=\"Normal\" max=\"10.0\" mean=\"8.0\" min=\"6.0\" sd=\"0.5\"/>\n" +
            "        <jamgap dist=\"LogNormal\" max=\"6.0\" mean=\"4.0\" min=\"2.0\" sd=\"0.5\"/>\n" +
            "        <vf dist=\"Normal\" max=\"100.0\" mean=\"85.0\" min=\"70.0\" sd=\"10.0\"/>\n" +
            "        <reaction_time dist=\"LogNormal\" max=\"3.5\" mean=\"2.4\" min=\"1.5\" sd=\"0.5\"/>\n" +
            "        <max_acc dist=\"Normal\" max=\"1.8\" mean=\"1.0\" min=\"0.6\" sd=\"0.5\"/>\n" +
            "        <max_dec dist=\"Normal\" max=\"6.0\" mean=\"5.0\" min=\"4.0\" sd=\"0.5\"/>\n" +
            "        <lc_param1 dist=\"Normal\" max=\"0.04\" mean=\"0.025\" min=\"0.01\" sd=\"0.02\"/>\n" +
            "        <lc_param2 dist=\"Normal\" max=\"0.08\" mean=\"0.055\" min=\"0.03\" sd=\"0.02\"/>\n" +
            "        <lc_sensitivity dist=\"LogNormal\" max=\"0.1\" mean=\"0.0033\" min=\"0.001\" sd=\"2.5\"/>\n",
            "NormalBus",
            "        <veh_len dist=\"Normal\" max=\"11.0\" mean=\"11.0\" min=\"11.0\" sd=\"0\"/>\n" +
            "        <jamgap dist=\"LogNormal\" max=\"2.5\" mean=\"2.0\" min=\"1.5\" sd=\"0.5\"/>\n" +
            "        <vf dist=\"Normal\" max=\"50.0\" mean=\"45.0\" min=\"40.0\" sd=\"10.0\"/>\n" +
            "        <reaction_time dist=\"LogNormal\" max=\"3.5\" mean=\"2.4\" min=\"1.5\" sd=\"0.2\"/>\n" +
            "        <max_acc dist=\"Normal\" max=\"4.0\" mean=\"3.0\" min=\"2.0\" sd=\"0.5\"/>\n" +
            "        <max_dec dist=\"Normal\" max=\"3.6\" mean=\"3.3\" min=\"3\" sd=\"0.5\"/>\n" +
            "        <lc_param1 dist=\"Normal\" max=\"0.04\" mean=\"0.025\" min=\"0.01\" sd=\"0.02\"/>\n" +
            "        <lc_param2 dist=\"Normal\" max=\"0.08\" mean=\"0.055\" min=\"0.03\" sd=\"0.02\"/>\n" +
            "        <lc_sensitivity dist=\"LogNormal\" max=\"0.1\" mean=\"0.0033\" min=\"0.001\" sd=\"2.5\"/>\n",
            "AutonomousBus",
            "        <veh_len dist=\"Normal\" max=\"11.0\" mean=\"11.0\" min=\"11.0\" sd=\"0\"/>\n" +
            "        <jamgap dist=\"LogNormal\" max=\"6.0\" mean=\"4.0\" min=\"2.0\" sd=\"0.01\"/>\n" +
            "        <vf dist=\"Normal\" max=\"80.0\" mean=\"70.0\" min=\"50.0\" sd=\"0.01\"/>\n" +
            "        <reaction_time dist=\"LogNormal\" max=\"3.5\" mean=\"2.4\" min=\"1.5\" sd=\"0.01\"/>\n" +
            "        <max_acc dist=\"Normal\" max=\"1.8\" mean=\"1.0\" min=\"0.8\" sd=\"0.01\"/>\n" +
            "        <max_dec dist=\"Normal\" max=\"6.0\" mean=\"5.0\" min=\"4.0\" sd=\"0.01\"/>\n" +
            "        <lc_param1 dist=\"Normal\" max=\"0.04\" mean=\"0.025\" min=\"0.01\" sd=\"0.02\"/>\n" +
            "        <lc_param2 dist=\"Normal\" max=\"0.08\" mean=\"0.055\" min=\"0.03\" sd=\"0.02\"/>\n" +
            "        <lc_sensitivity dist=\"LogNormal\" max=\"0.1\" mean=\"0.0033\" min=\"0.001\" sd=\"2.5\"/>\n",
            "TRT",
            "        <veh_len dist=\"Normal\" max=\"10.0\" mean=\"10.0\" min=\"10.0\" sd=\"0\"/>\n" +
            "        <jamgap dist=\"LogNormal\" max=\"5.0\" mean=\"3.5\" min=\"2.5\" sd=\"0.01\"/>\n" +
            "        <vf dist=\"Normal\" max=\"75.0\" mean=\"75.0\" min=\"75.0\" sd=\"0\"/>\n" +
            "        <reaction_time dist=\"LogNormal\" max=\"3.0\" mean=\"2.0\" min=\"1.0\" sd=\"0.01\"/>\n" +
            "        <max_acc dist=\"Normal\" max=\"3\" mean=\"2.5\" min=\"2\" sd=\"0.1\"/>\n" +
            "        <max_dec dist=\"Normal\" max=\"2.0\" mean=\"2.0\" min=\"2.0\" sd=\"0\"/>\n" +
            "        <lc_param1 dist=\"Normal\" max=\"0.04\" mean=\"0.025\" min=\"0.01\" sd=\"0.02\"/>\n" +
            "        <lc_param2 dist=\"Normal\" max=\"0.08\" mean=\"0.055\" min=\"0.03\" sd=\"0.02\"/>\n" +
            "        <lc_sensitivity dist=\"LogNormal\" max=\"0.1\" mean=\"0.0033\" min=\"0.001\" sd=\"2.5\"/>\n");

    private static final Map<String, String> DEFAULT_VEHTYPE_MAXPAX = Map.of(
            "NormalVeh", "0", "AutonomousVeh", "15", "Truck", "1",
            "NormalBus", "30", "AutonomousBus", "30", "TRT", "91");

    /** vehicle_type.nextsim_type_code(쉼표구분 코드) → NextSim 정식 카테고리 이름 */
    private static final Map<String, String> CODE_TO_CANONICAL_NAME = Map.of(
            "NV", "NormalVeh", "AV", "AutonomousVeh",
            "NB", "NormalBus", "AB", "AutonomousBus",
            "TRUCK", "Truck", "TRK", "Truck", "TR", "Truck");

    /**
     * "교통수단 유형" 편집 화면(VehicleType + VehicleTypeParameter, VehicleTypeController가
     * 관리)의 내용으로 vehicletypes.xml을 생성한다.
     *
     * <p>⚠️ 실측 확인된 회귀(2026-07-27): 처음 구현 시 vehtype의 name 속성에 편집 화면의
     * 한글 이름(예: "택시", "버스")을 그대로 썼는데, NextSim 엔진은 "Initializing NB/AB/TRT"
     * 단계에서 vehtype 목록을 **정식 카테고리 이름**(NormalVeh/AutonomousVeh/Truck/NormalBus/
     * AutonomousBus/TRT)으로 조회한다. 이름이 일치하지 않으면 에러 없이 "Complete: Initializing
     * Public Transit" 직후 출력 없이 CPU 100%로 무한 행(hang)한다 — bus/rail 작업과 무관하게
     * 이번 세션의 모든 시나리오에서 재현된 전역 회귀였다(scenario1_1 등, 오늘 건드리지 않은
     * 시나리오 포함). veh_width 속성 누락도 배포판 예시와의 또 다른 차이점이라 함께 채운다
     * (편집 화면에 아직 이 파라미터가 없어 고정값 사용).
     *
     * <p>따라서 vehicle_type.nextsim_type_code(NV/AV/NB/AB/TRK/TR/TRUCK)로 6개 정식 카테고리에
     * 매핑되는 DB 행을 찾아 그 파라미터로 해당 카테고리를 채우고, 매핑되는 행이 없는 카테고리는
     * 배포판 기본값을 그대로 사용해 6개 카테고리가 항상 전부 존재하도록 보장한다. 매핑된
     * 카테고리가 하나도 없으면(어떤 차종에도 코드 미설정) null — 호출측이 배포판 템플릿을
     * 통째로 그대로 둔다.
     */
    private String buildVehicleTypesXml() {
        List<VehicleType> types = vehicleTypeRepository.findAll();

        // canonical name → 그 이름을 채울 DB 차종(첫 매치 우선)
        Map<String, VehicleType> canonicalToSource = new java.util.LinkedHashMap<>();
        for (VehicleType vt : types) {
            if (vt.getNextsimTypeCode() == null || vt.getNextsimTypeCode().isBlank()) continue;
            for (String code : vt.getNextsimTypeCode().split(",")) {
                String canonical = CODE_TO_CANONICAL_NAME.get(code.trim().toUpperCase());
                if (canonical != null) canonicalToSource.putIfAbsent(canonical, vt);
            }
        }
        if (canonicalToSource.isEmpty()) return null; // 매핑된 코드 없음 — 배포판 템플릿 그대로

        StringBuilder sb = new StringBuilder("<VehType_Scenario>\n");
        int idx = 0;
        for (String canonicalName : REQUIRED_VEHTYPE_NAMES) {
            VehicleType vt = canonicalToSource.get(canonicalName);
            sb.append("    <vehtype id=\"").append(idx++)
              .append("\" max_pax=\"").append(vt != null ? escapeXmlAttr(vt.getMaxPax()) : DEFAULT_VEHTYPE_MAXPAX.get(canonicalName))
              .append("\" name=\"").append(canonicalName)
              .append("\" v2x=\"").append(vt != null ? escapeXmlAttr(vt.getV2x()) : "off")
              .append("\">\n");
            sb.append("        <veh_width dist=\"Normal\" max=\"2.1\" mean=\"1.9\" min=\"1.8\" sd=\"0.2\"/>\n");
            if (vt != null) {
                List<VehicleTypeParameter> params = vehicleTypeParameterRepository.findByVehicleType_Id(vt.getId());
                for (VehicleTypeParameter p : params) {
                    sb.append("        <").append(p.getParameterName())
                      .append(" dist=\"").append(normalizeDist(p.getDist()))
                      .append("\" max=\"").append(escapeXmlAttr(p.getMax()))
                      .append("\" mean=\"").append(escapeXmlAttr(p.getMean()))
                      .append("\" min=\"").append(escapeXmlAttr(p.getMin()))
                      .append("\" sd=\"").append(escapeXmlAttr(p.getSd()))
                      .append("\"/>\n");
                }
            } else {
                sb.append(DEFAULT_VEHTYPE_BODY.get(canonicalName));
            }
            sb.append("    </vehtype>\n");
        }
        sb.append("</VehType_Scenario>");
        return xml(sb.toString());
    }

    /** "normal"/"lognormal"(편집 화면 select 옵션, 소문자) → NextSim이 기대하는 대문자
     *  표기("Normal"/"LogNormal", 실측 vehicletypes.xml 샘플 기준)로 정규화. */
    private static String normalizeDist(String dist) {
        if (dist != null && dist.equalsIgnoreCase("lognormal")) return "LogNormal";
        return "Normal";
    }

    private static String escapeXmlAttr(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /**
     * "버스 노선"(BusPtLineService, roadPTline.xml) + "버스 정류장"(BusStationService,
     * roadStation.xml) 데이터를 조합해 NextSim이 기대하는 roadPTline.xml 스키마
     * (NEXTSIM_DATA_STRUCTURE.md: {@code <Line id fee interval><links><link id seq station
     * use_ptlane/></links></Line>})로 변환한다.
     *
     * <p>우리 {@code BusPtLinesXml.LineXml}은 노선 하나를 link/node/station/garage 4개의
     * "공백구분 id 목록" 문자열로 담는다 — link 목록의 등장 순서가 곧 노선이 지나가는
     * 순서다. NextSim 스키마는 링크마다 개별 {@code <link id seq .../>} 요소가 필요하고
     * (seq = 0부터 순번), 그중 정류장이 있는 링크에만 station 속성을 붙인다. 어느 링크가
     * 정류장인지는 노선 파일 자체엔 없고, 정류장 레코드(BusStationResponse.linkRef —
     * "이 정류장은 어느 링크 위에 있다")로 역매핑해야 한다.
     *
     * <p>fee(요금)/use_ptlane은 우리 데이터에 없는 필드라 각각 0/"False"로 기본값 처리한다.
     * 노선 데이터가 없으면(파일 없음·빈 목록) null — 호출측이 안전한 빈 스텁을 쓴다.
     */
    private String buildRoadPtLineXml(String versionId) {
        com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml lines;
        try {
            lines = busPtLineService.getDefault(versionId);
        } catch (Exception e) {
            return null; // roadPTline.xml 없음/파싱 실패 — 노선 미정의로 보고 안전 스텁에 맡김
        }
        if (lines == null || lines.getLines() == null || lines.getLines().isEmpty()) return null;

        // 정류장 id → 그 정류장이 위치한 링크 id (문자열 비교용으로 String화)
        Map<String, String> stationIdToLinkId = new HashMap<>();
        try {
            var stations = busStationService.getBusStationsByVersionId(versionId).getBusStations();
            if (stations != null) {
                for (var st : stations) {
                    if (st.getId() != null && st.getLinkRef() != null) {
                        stationIdToLinkId.put(st.getId(), String.valueOf(st.getLinkRef()));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[NextSimRunner] {} 정류장 조회 실패(station 속성 없이 진행): {}", versionId, e.getMessage());
        }

        StringBuilder sb = new StringBuilder("<Lines mode=\"Bus\">\n");
        for (var line : lines.getLines()) {
            String linkSeq = line.getLink() != null ? line.getLink().getSeq() : null;
            if (linkSeq == null || linkSeq.isBlank()) continue; // 경로 없는 노선은 건너뜀

            String[] linkIds = linkSeq.trim().split("\\s+");
            String stationSeq = line.getStation() != null ? line.getStation().getSeq() : null;
            Set<String> routeStationIds = (stationSeq == null || stationSeq.isBlank())
                    ? Set.of() : Set.of(stationSeq.trim().split("\\s+"));

            sb.append("    <Line id=\"").append(escapeXmlAttr(line.getId()))
              .append("\" fee=\"0\" interval=\"").append(line.getInterval() != null ? line.getInterval() : 10)
              .append("\">\n        <links>\n");
            for (int i = 0; i < linkIds.length; i++) {
                String linkId = linkIds[i];
                String stationAttr = "";
                for (String stId : routeStationIds) {
                    if (linkId.equals(stationIdToLinkId.get(stId))) {
                        stationAttr = " station=\"" + escapeXmlAttr(stId) + "\"";
                        break;
                    }
                }
                sb.append("            <link id=\"").append(escapeXmlAttr(linkId))
                  .append("\" seq=\"").append(i).append('"')
                  .append(stationAttr)
                  .append(" use_ptlane=\"False\"/>\n");
            }
            sb.append("        </links>\n    </Line>\n");
        }
        sb.append("</Lines>");
        return xml(sb.toString());
    }

    /**
     * railPTline.xml을 "철도 노선" 편집 화면(RailPtLineController/RailPtLineXml.RouteXml —
     * id/name/railStationSeq/fee/departureTime/timeOffsetSeq) 데이터로 생성한다. buildRoadPtLineXml과
     * 동일한 "DB에서 직접 생성" 패턴.
     *
     * <p>실측 확인: NextSim 배포판이 기본 제공하던 "안전한 예시"(bucheon railPTline.xml)를
     * 그대로 복사하던 기존 방식은 실제로는 안전하지 않았다 — 그 예시는 bucheon 자신의
     * railStation.xml(정류장 40000001/2/3)에만 유효한 실제 지하철 노선 데이터를 담고 있어,
     * 우리 쪽처럼 railStation.xml이 비어있는(정류장 0개) 네트워크에 그대로 꽂으면 존재하지 않는
     * 역을 참조하는 노선이 되어버린다(이후 실행 이상 현상들의 잠재 원인 중 하나로 의심됨).
     * 실제 철도 노선 데이터가 없으면 완전히 빈(0개 노선) stub을 대신 쓴다 — 실측으로 이 형태
     * (제대로 된 root+Lines 요소, 내용만 빈) 자체는 안전함을 확인함(SIGSEGV 유발한 것으로
     * 알려졌던 과거 시도는 root 요소 자체가 없거나 Lines 자식이 아예 없는 더 퇴화된 형태였던
     * 것으로 추정).
     */
    private String buildRailPtLineXml(String versionId) {
        com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml lines;
        try {
            lines = railPtLineService.getByScenarioKey(versionId);
        } catch (Exception e) {
            return null; // railPTline.xml 없음/파싱 실패 — 노선 미정의로 보고 안전 스텁에 맡김
        }
        if (lines == null || lines.getRoutes() == null || lines.getRoutes().isEmpty()) return null;

        StringBuilder sb = new StringBuilder("<Mode type=\"subway\">\n    <Lines>\n");
        for (var route : lines.getRoutes()) {
            String stationSeq = route.getRailStationSeq();
            if (stationSeq == null || stationSeq.isBlank()) continue; // 역 시퀀스 없는 노선은 건너뜀

            String[] stationIds = stationSeq.trim().split("\\s+");
            String[] timeOffsets = (route.getTimeOffsetSeq() == null || route.getTimeOffsetSeq().isBlank())
                    ? new String[0] : route.getTimeOffsetSeq().trim().split("\\s+");
            String fee = (route.getFee() == null || route.getFee().isBlank()) ? "0" : route.getFee();
            String departureTime = route.getDepartureTime() == null ? "" : route.getDepartureTime();

            sb.append("        <Line id=\"").append(escapeXmlAttr(String.valueOf(route.getId())))
              .append("\" fee=\"").append(escapeXmlAttr(fee))
              .append("\" departureTime=\"").append(escapeXmlAttr(departureTime))
              .append("\">\n");
            for (int i = 0; i < stationIds.length; i++) {
                String offset = i < timeOffsets.length ? timeOffsets[i] : "0";
                sb.append("            <stationSeq id=\"").append(escapeXmlAttr(stationIds[i]))
                  .append("\" seq=\"").append(i)
                  .append("\" timeOffset=\"").append(escapeXmlAttr(offset))
                  .append("\" />\n");
            }
            sb.append("        </Line>\n");
        }
        sb.append("    </Lines>\n</Mode>");
        return xml(sb.toString());
    }

    private static String tail(String s, int max) {
        return s.length() <= max ? s : s.substring(s.length() - max);
    }

    private static String sanitize(String s) {
        return s.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static void copyDir(Path src, Path dst) throws IOException {
        if (!Files.isDirectory(src)) throw new IOException("배포판 폴더 없음: " + src);
        Files.createDirectories(dst);
        try (var stream = Files.list(src)) {
            for (Path p : stream.toList()) {
                if (Files.isRegularFile(p)) {
                    Files.copy(p, dst.resolve(p.getFileName().toString()),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }

    private static void deleteDir(Path dir) {
        if (!Files.exists(dir)) return;
        try (var stream = Files.walk(dir)) {
            stream.sorted(Comparator.reverseOrder())
                  .forEach(p -> { try { Files.delete(p); } catch (IOException ignored) {} });
        } catch (IOException ignored) {}
    }
}
