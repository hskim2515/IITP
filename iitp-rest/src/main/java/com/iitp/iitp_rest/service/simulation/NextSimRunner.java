package com.iitp.iitp_rest.service.simulation;

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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NextSim(KAIST 교통 시뮬레이터) 실행 인터페이스.
 *
 * <p>배포판(nextsim-linux-x64) 바이너리를 Docker(linux/amd64)로 실행한다.
 * 버전 스토리지의 입력 파일(network.xml / signal.xml / signalTOD.xml / odmatrix.xml /
 * scenario.xml — 모두 NextSim 형식 그대로 플랫폼이 관리 중)을 실행 워크스페이스에
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

    private final FileStorageService fileStorage;
    private final VehicleDataReader vehicleDataReader;
    private final ScenarioVersionRepository scenarioVersionRepository;

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
            progress.accept("입력 데이터 스테이징 중...");
            stageInputs(versionId, inputDir, networkDir);

            // 경로 캐시: route-generator 는 odmatrix 와 무관하게 **네트워크의 전 터미널 쌍**을
            // 계산한다(실측 — 2-demand OD 와 2021-demand OD 의 Route.json 이 동일). 따라서
            // 캐시 키 = 스테이징(보정·가지치기 후) network.xml 만. OD 의 flow 만 바뀐 재실행은
            // 가장 비싼 단계인 route-generator 를 통째로 생략한다.
            // (터미널 가지치기 사용 시 OD 의 터미널 집합이 바뀌면 스테이징 network 도 바뀌어
            //  자연히 캐시 미스 → 정확성 유지)
            String inputsHash = sha256Of(networkDir.resolve("network.xml"));
            Path cacheDir = routeCacheDir(versionId);
            Path routeJson = networkDir.resolve("Route.json");
            if (isRouteCacheHit(cacheDir, inputsHash)) {
                progress.accept("경로 캐시 재사용 — 경로 생성 생략");
                Files.copy(cacheDir.resolve("Route.json"), routeJson,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                Path cachedPt = cacheDir.resolve("PTRoute.json");
                if (Files.exists(cachedPt)) {
                    Files.copy(cachedPt, networkDir.resolve("PTRoute.json"),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
                log.info("[NextSimRunner] 경로 캐시 히트: {} (hash={})", versionId, inputsHash.substring(0, 12));
            } else {
                progress.accept("경로 생성 중 (route-generator)...");
                String routeLog = runStage(versionId, workDir, "route-generator", "RouteGenerator", progress);
                if (!Files.exists(routeJson)) {
                    throw new RuntimeException("route-generator 가 Route.json 을 생성하지 않았습니다. " +
                            "odmatrix.xml 의 source/sink 노드가 네트워크와 일치하는지 확인하세요.\n" + tail(routeLog, 800));
                }
            }

            progress.accept("시뮬레이션 실행 중 (nextsim)...");
            String simLog = runStage(versionId, workDir, "nextsim", "Simulation", progress);

            Path resultDb = outputDir.resolve("simulation_output.db");
            if (!Files.exists(resultDb) || Files.size(resultDb) == 0) {
                throw new RuntimeException("시뮬레이션 결과(simulation_output.db)가 생성되지 않았습니다.\n" + tail(simLog, 800));
            }

            progress.accept("결과 저장 중...");
            // NextSim VehicleEvent 스키마 == VehicleDataReader 신형 스키마 → 그대로 vehicle_sim.db 로
            try (InputStream in = new FileInputStream(resultDb.toFile())) {
                fileStorage.uploadFile(in, versionId, "vehicle_sim.db");
            }
            vehicleDataReader.invalidateDbCache(versionId);

            // 경로 캐시 갱신 — 다음 실행(같은 network/OD)은 route-generator 생략
            saveRouteCache(cacheDir, inputsHash, routeJson, networkDir.resolve("PTRoute.json"));

            log.info("[NextSimRunner] 완료: versionId={}, result={} bytes", versionId, Files.size(resultDb));
            return tail(simLog, 2000);
        } finally {
            activeVersionId = null;
            activeProcess = null;
            activeContainer = null;
            // 결과 회수 후 워크스페이스 정리 (실패 시엔 디버깅용으로 보존)
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

    private void saveRouteCache(Path cacheDir, String inputsHash, Path routeJson, Path ptRouteJson) {
        try {
            Files.createDirectories(cacheDir);
            Files.copy(routeJson, cacheDir.resolve("Route.json"),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            if (Files.exists(ptRouteJson)) {
                Files.copy(ptRouteJson, cacheDir.resolve("PTRoute.json"),
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

    private void stageInputs(String versionId, Path inputDir, Path networkDir) throws IOException {
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
                "    <SignalEvent active=\"f\" />\n" +
                "    <SignalControlEvent active=\"f\" />\n" +
                "</RecordModes>"), StandardCharsets.UTF_8);

        // 3) 버전 스토리지 파일 (플랫폼이 NextSim 형식 그대로 관리 중)
        //    network.xml 필수, odmatrix.xml 필수(수요 없으면 시뮬 무의미), 나머지는 폴백 생성
        copyRequired(versionId, "network.xml", networkDir,
                "network.xml 이 없습니다 — 네트워크를 먼저 가져오기/저장하세요.");
        copyRequired(versionId, "odmatrix.xml", networkDir,
                "odmatrix.xml 이 없습니다 — OD 매트릭스 메뉴에서 수요를 생성/저장하세요.");
        // KTDB 변환 네트워크 호환 보정 + 미사용 터미널 가지치기 (스테이징 사본, 단일 패스):
        // - NextSim 파서가 <port direction>/<node v2x> 를 필수 속성으로 요구(실측) → 빈 값 주입
        // - route-generator 는 odmatrix 무관 **전 터미널 쌍** 최단경로를 계산(실측 — 수도권
        //   11,895 터미널 = ~3,500만 쌍으로 77분+ 미완의 근본 원인). OD 가 참조하지 않는
        //   터미널을 normal 로 바꾸면 OD 관련 쌍만 계산된다. 미사용 터미널은 막다른 경계
        //   노드라 어떤 경로도 통과하지 않음 → 수요가 참조하지 않는 한 시뮬 결과 불변.
        Set<String> odNodeIds = pruneUnusedTerminals ? extractOdNodeIds(networkDir.resolve("odmatrix.xml")) : null;
        injectRequiredNetworkAttrs(networkDir.resolve("network.xml"), odNodeIds);

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
            Files.writeString(networkDir.resolve("scenario.xml"), xml(
                    "<Scenarios>\n" +
                    "\t<Scenario id=\"0\" startTime=\"06:00:00\" duration=\"60\" BGTduration=\"0\" odMatrixID=\"0\" todID=\"0\" signalControl=\"False\"/>\n" +
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
        writeIfAbsent(networkDir, "passenger.xml", xml("<Passenger>\n\t<od_pax>\n\t</od_pax>\n</Passenger>"));
        writeIfAbsent(networkDir, "footpathNetwork.xml", xml("<Network id=\"0\">\n    <nodes>\n    </nodes>\n    <links>\n    </links>\n</Network>"));
        writeIfAbsent(networkDir, "roadPTline.xml", xml("<Lines mode=\"Bus\">\n</Lines>"));
        writeIfAbsent(networkDir, "roadStation.xml", xml("<PublicTransit>\n  <Stations>\n  </Stations>\n</PublicTransit>"));
        writeIfAbsent(networkDir, "railStation.xml", xml("<RailPublicTransit>\n</RailPublicTransit>"));
        writeIfAbsent(networkDir, "backgroundTraffic.xml", xml("<BackgroundTraffics>\n</BackgroundTraffics>"));
        // ⚠️ railPTline.xml 은 자체 제작 빈 XML(<Mode/> 루트, 주석-only 둘 다)이 nextsim 을
        //    SIGSEGV 로 죽인다(실측 — 파서가 이 파일을 특수 처리). 배포판 예시 파일(내용 전체가
        //    주석이라 네트워크 무관 = 사실상 빈 노선)을 그대로 복사하는 것만 안전.
        if (!Files.exists(networkDir.resolve("railPTline.xml"))) {
            Path bundled = Path.of(nextsimHome, "SimulationInput", "datasets", BRANCH,
                    "network_xml_bucheon", "railPTline.xml");
            if (Files.exists(bundled)) {
                Files.copy(bundled, networkDir.resolve("railPTline.xml"));
            } else {
                throw new IOException("배포판 railPTline.xml 예시가 없습니다: " + bundled +
                        " — 버전에 railPTline.xml 을 직접 추가하세요.");
            }
        }
    }

    /** scenario.xml 내용을 config_scenario.json 으로 미러링 (배포판이 양쪽을 두는 관례 준수) */
    private void writeConfigScenarioJson(Path networkDir) throws IOException {
        String xml = Files.readString(networkDir.resolve("scenario.xml"), StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("<Scenario\\s+([^/>]*)/>").matcher(xml);
        List<String> items = new ArrayList<>();
        while (m.find()) {
            String attrs = m.group(1);
            items.add(String.format(
                    "        {\n            \"id\": %s,\n            \"startTime\": \"%s\",\n            \"duration\": %s,\n" +
                    "            \"BGTduration\": %s,\n            \"odMatrixID\": %s,\n            \"todID\": %s,\n" +
                    "            \"trafficCenter\": {\n                \"signalControl\": { \"active\": false, \"interval\": 1.0 },\n" +
                    "                \"v2x\": { \"active\": false, \"interval\": 1.0 }\n            }\n        }",
                    attr(attrs, "id", "0"), attr(attrs, "startTime", "06:00:00"), attr(attrs, "duration", "60"),
                    attr(attrs, "BGTduration", "0"), attr(attrs, "odMatrixID", "0"), attr(attrs, "todID", "0")));
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
        Path tmp = networkXml.resolveSibling(networkXml.getFileName() + ".compat");
        long injected = 0, pruned = 0, keptTerminals = 0;
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
                    if (keepNodeIds != null && t.contains("type=\"terminal\"")) {
                        Matcher m = idAttr.matcher(t);
                        if (m.find() && !keepNodeIds.contains(m.group(1))) {
                            // garage: 막다른(단일 포트) 노드의 정식 타입 — "normal" 로 바꾸면
                            // route-generator 가 std::out_of_range 크래시(실측, 통과 노드 가정),
                            // garage 는 소스/싱크 열거에서 빠지면서 그래프 로드도 안전(실측 검증).
                            t = t.replace("type=\"terminal\"", "type=\"garage\"");
                            pruned++;
                        } else {
                            keptTerminals++;
                        }
                    }
                }
                writer.write(t);
            }
            if (tag != null) writer.write(tag.toString()); // 비정상 트레일링 보존
        }
        Files.move(tmp, networkXml, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        if (injected > 0) log.info("[NextSimRunner] network.xml 호환 보정: 필수 속성 {}건 주입", injected);
        if (keepNodeIds != null) {
            log.info("[NextSimRunner] 터미널 가지치기: 유지 {} / 전환 {} (OD 참조 노드 {}개)",
                    keptTerminals, pruned, keepNodeIds.size());
        }
    }

    /** odmatrix.xml 의 source/sink 노드 id 집합 (가지치기 유지 대상) */
    private static Set<String> extractOdNodeIds(Path odmatrixXml) throws IOException {
        Set<String> ids = new LinkedHashSet<>();
        String xml = Files.readString(odmatrixXml, StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("\\b(?:source|sink)=\"([^\"]+)\"").matcher(xml);
        while (m.find()) ids.add(m.group(1));
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
        Thread reader = new Thread(() -> {
            try (var br = new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                long lastProgressAt = 0;
                while ((line = br.readLine()) != null) {
                    synchronized (tailBuf) {
                        tailBuf.append(line).append('\n');
                        if (tailBuf.length() > 16000) tailBuf.delete(0, tailBuf.length() - 12000);
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
            throw new RuntimeException("NextSim 실행 타임아웃 (" + timeoutSeconds + "초) — " +
                    "대규모 네트워크는 nextsim.timeout-seconds 상향 또는 Linux 서버 네이티브 실행을 고려하세요");
        }
        reader.join(5000); // 잔여 출력 수집
        int exit = process.exitValue();
        String output;
        synchronized (tailBuf) { output = tailBuf.toString(); }
        if (cancelRequested.remove(versionId)) {
            throw new CancelledException();
        }
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
