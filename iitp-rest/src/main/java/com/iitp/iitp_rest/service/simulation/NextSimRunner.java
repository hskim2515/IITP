package com.iitp.iitp_rest.service.simulation;

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

    private static final String BRANCH = "mesopt";
    private static final String NETWORK_NAME = "iitp";

    private final FileStorageService fileStorage;
    private final VehicleDataReader vehicleDataReader;

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

        try {
            progress.accept("입력 데이터 스테이징 중...");
            stageInputs(versionId, inputDir, networkDir);

            progress.accept("경로 생성 중 (route-generator)...");
            String routeLog = runInDocker(workDir, "./route-generator -tc=\"RouteGenerator\"", progress);
            Path routeJson = networkDir.resolve("Route.json");
            if (!Files.exists(routeJson)) {
                throw new RuntimeException("route-generator 가 Route.json 을 생성하지 않았습니다. " +
                        "odmatrix.xml 의 source/sink 노드가 네트워크와 일치하는지 확인하세요.\n" + tail(routeLog, 800));
            }

            progress.accept("시뮬레이션 실행 중 (nextsim)...");
            String simLog = runInDocker(workDir, "./nextsim -tc=\"Simulation\"", progress);

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
            log.info("[NextSimRunner] 완료: versionId={}, result={} bytes", versionId, Files.size(resultDb));
            return tail(simLog, 2000);
        } finally {
            // 결과 회수 후 워크스페이스 정리 (실패 시엔 디버깅용으로 보존)
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

        // 3) 버전 스토리지 파일 (플랫폼이 NextSim 형식 그대로 관리 중)
        //    network.xml 필수, odmatrix.xml 필수(수요 없으면 시뮬 무의미), 나머지는 폴백 생성
        copyRequired(versionId, "network.xml", networkDir,
                "network.xml 이 없습니다 — 네트워크를 먼저 가져오기/저장하세요.");
        copyRequired(versionId, "odmatrix.xml", networkDir,
                "odmatrix.xml 이 없습니다 — OD 매트릭스 메뉴에서 수요를 생성/저장하세요.");

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

    // ─────────────────────────── Docker 실행 ───────────────────────────

    private String runInDocker(Path workDir, String command, Consumer<String> progress) throws Exception {
        List<String> cmd = List.of(
                "docker", "run", "--rm",
                "--platform", dockerPlatform,
                "-v", Path.of(nextsimHome, "Captain").toAbsolutePath() + ":/ns/Captain:ro",
                "-v", workDir.resolve("SimulationInput").toAbsolutePath() + ":/ns/SimulationInput",
                "-v", workDir.resolve("SimulationOutput").toAbsolutePath() + ":/ns/SimulationOutput",
                "-w", "/ns/Captain/build/bin",
                dockerImage,
                "bash", "-lc", command
        );
        log.info("[NextSimRunner] docker 실행: {}", String.join(" ", cmd));

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process process;
        try {
            process = pb.start();
        } catch (IOException e) {
            throw new RuntimeException("Docker 실행 실패 — Docker 데몬이 실행 중인지 확인하세요: " + e.getMessage(), e);
        }

        // 출력 tail 유지 + 진행 로그 (대용량 출력으로 메모리 안 부풀도록)
        StringBuilder tailBuf = new StringBuilder();
        try (var br = new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))) {
            String line;
            long lastProgressAt = 0;
            while ((line = br.readLine()) != null) {
                tailBuf.append(line).append('\n');
                if (tailBuf.length() > 16000) tailBuf.delete(0, tailBuf.length() - 12000);
                long now = System.currentTimeMillis();
                if (now - lastProgressAt > 3000 && !line.isBlank()) {
                    lastProgressAt = now;
                    progress.accept(line.length() > 120 ? line.substring(0, 120) : line);
                }
            }
        }
        boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new RuntimeException("NextSim 실행 타임아웃 (" + timeoutSeconds + "초)");
        }
        int exit = process.exitValue();
        if (exit != 0) {
            throw new RuntimeException("NextSim 실행 실패 (exit=" + exit + "):\n" + tail(tailBuf.toString(), 1200));
        }
        return tailBuf.toString();
    }

    // ─────────────────────────── 유틸 ───────────────────────────

    private void copyRequired(String versionId, String fileName, Path dstDir, String missingMsg) throws IOException {
        if (!copyOptional(versionId, fileName, dstDir)) {
            throw new IOException("[" + versionId + "] " + missingMsg);
        }
    }

    /** 버전 스토리지 → 스테이징 복사. 존재하면 true. (대용량 대비 스트림 복사) */
    private boolean copyOptional(String versionId, String fileName, Path dstDir) throws IOException {
        String key = versionId + "/" + fileName;
        if (!fileStorage.exists(key)) return false;
        byte[] bytes = fileStorage.readFile(key);
        try (InputStream in = new ByteArrayInputStream(bytes)) {
            Files.copy(in, dstDir.resolve(fileName), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        return true;
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
