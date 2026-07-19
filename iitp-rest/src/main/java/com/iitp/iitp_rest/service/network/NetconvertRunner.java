package com.iitp.iitp_rest.service.network;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * SUMO netconvert Docker 래퍼.
 * OSM XML bytes → SUMO net.xml bytes 변환.
 *
 * 실행 전제: Docker Desktop 설치 + /tmp 디렉터리 공유 허용
 *   macOS Docker Desktop → Settings → Resources → File Sharing → /tmp 추가
 *
 * Docker 이미지 수동 pull (선택):
 *   docker pull ghcr.io/eclipse-sumo/sumo:latest
 */
@Slf4j
@Service
public class NetconvertRunner {

    @Value("${sumo.docker.image:ghcr.io/eclipse-sumo/sumo:latest}")
    private String dockerImage;

    /** Docker 컨테이너에 마운트할 호스트 측 temp 기반 경로 (/tmp 권장) */
    @Value("${sumo.docker.temp-dir:/tmp}")
    private String tempBase;

    @Value("${sumo.netconvert.timeout-seconds:120}")
    private int timeoutSeconds;

    /**
     * @param osmXmlBytes OSM XML (Overpass 또는 KTDB 변환)
     * @return SUMO net.xml bytes
     */
    public byte[] run(byte[] osmXmlBytes) throws Exception {
        return run(osmXmlBytes, true);
    }

    /**
     * @param osmXmlBytes      OSM XML
     * @param removeIsolated   true: 고립 엣지 제거 (OSM용), false: bbox 경계 엣지 보존 (KTDB용)
     * @return SUMO net.xml bytes
     */
    public byte[] run(byte[] osmXmlBytes, boolean removeIsolated) throws Exception {
        return run(osmXmlBytes, removeIsolated, false);
    }

    /**
     * @param osmXmlBytes      OSM XML
     * @param removeIsolated   true: 고립 엣지 제거 (OSM용)
     * @param ktdbMode         true: KTDB 전용 옵션 (vclass 필터/junction join 완화)
     * @return SUMO net.xml bytes
     */
    public byte[] run(byte[] osmXmlBytes, boolean removeIsolated, boolean ktdbMode) throws Exception {
        Path tempDir = Files.createDirectory(
                Path.of(tempBase, "sumo_" + UUID.randomUUID().toString().substring(0, 8)));
        try {
            Path osmFile = tempDir.resolve("input.osm");
            Path netFile = tempDir.resolve("output.net.xml");
            Files.write(osmFile, osmXmlBytes);

            String hostMount = tempDir.toAbsolutePath().toString();

            var cmd = new java.util.ArrayList<>(List.of(
                "docker", "run", "--rm",
                "-v", hostMount + ":/data",
                dockerImage,
                "netconvert",
                "--osm-files",    "/data/input.osm",
                "--output-file",  "/data/output.net.xml"
            ));

            if (ktdbMode) {
                // KTDB: 단방향 데이터, vclass 필터 없이 전체 도로 보존, junction join 최소화
                cmd.addAll(List.of(
                    "--junctions.join",           "false",
                    "--tls.guess-signals",        "true",
                    "--osm.oneway-spread-right",  "true"
                ));
            } else {
                // OSM: 표준 옵션
                cmd.addAll(List.of(
                    "--junctions.join",          "true",
                    "--keep-edges.by-vclass",    "passenger,hov,emergency,bus,rail,tram",
                    "--osm.oneway-spread-right", "true",
                    "--tls.guess-signals",       "true",
                    "--no-warnings",             "true"
                ));
            }

            if (removeIsolated) {
                cmd.add("--remove-edges.isolated");
                cmd.add("true");
            }

            log.info("netconvert(Docker) 실행: image={}, mount={}, cmd={}", dockerImage, hostMount, cmd);

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);

            Process process;
            try {
                process = pb.start();
            } catch (IOException e) {
                throw new RuntimeException(
                    "Docker 실행 실패 — Docker Desktop이 설치·실행 중인지 확인하세요: " + e.getMessage(), e);
            }

            String output = new String(process.getInputStream().readAllBytes());
            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);

            if (!finished) {
                process.destroyForcibly();
                throw new RuntimeException("netconvert 타임아웃 (" + timeoutSeconds + "초)");
            }

            int exitCode = process.exitValue();
            if (exitCode != 0 || !Files.exists(netFile)) {
                String excerpt = output.length() > 800 ? output.substring(0, 800) + "..." : output;
                throw new RuntimeException("netconvert 실패 (exit=" + exitCode + "):\n" + excerpt);
            }

            if (!output.isBlank()) {
                log.info("netconvert 출력:\n{}", output.length() > 2000 ? output.substring(0, 2000) + "..." : output);
            }

            byte[] result = Files.readAllBytes(netFile);
            log.info("netconvert 완료: {} bytes", result.length);
            return result;

        } finally {
            // KTDB 디버그: OSM XML과 net.xml 보존 (확인 후 삭제)
            if (ktdbMode) {
                log.info("[KTDB DEBUG] OSM XML: {}", tempDir.resolve("input.osm"));
                log.info("[KTDB DEBUG] net.xml: {}", tempDir.resolve("output.net.xml"));
            } else {
                deleteDir(tempDir);
            }
        }
    }

    private void deleteDir(Path dir) {
        try (var stream = Files.walk(dir)) {
            stream.sorted(Comparator.reverseOrder())
                  .forEach(p -> { try { Files.delete(p); } catch (IOException ignored) {} });
        } catch (IOException ignored) {}
    }
}
