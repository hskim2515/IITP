package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.*;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.road.RoadResponse;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.vehicle.route.VehicleRequest;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.signal.SignalTimelineResponse;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.util.FileStorageService;
import com.iitp.iitp_rest.service.scenario.ScenarioService;
import com.iitp.iitp_rest.service.signal.SignalTimelineService;
import com.iitp.iitp_rest.service.vehicle.DummySignalGenerator;
import com.iitp.iitp_rest.service.vehicle.DummyVehicleGenerator;
import com.iitp.iitp_rest.service.vehicle.VehicleRouteService;
import com.iitp.iitp_rest.util.CoordinateConverter;
import com.iitp.iitp_rest.util.GeoJsonUtils;
import com.iitp.iitp_rest.util.VehicleDataReader;
import com.iitp.iitp_rest.util.RemoteXmlFetch;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import javax.xml.parsers.DocumentBuilderFactory;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/vehicle")
@RequiredArgsConstructor
public class VehicleController {

    private static final Logger logger = LoggerFactory.getLogger(VehicleController.class);

    private final VehicleDataReader vehicleDataReader;
    private final ScenarioService scenarioService;
    private final VehicleRouteService vehicleRouteService;
    private final SignalTimelineService signalTimelineService;
    private final NetworkService networkService;
    private final NetworkTileService networkTileService;
    private final DummyVehicleGenerator dummyVehicleGenerator;
    private final DummySignalGenerator dummySignalGenerator;
    private final FileStorageService fileStorage;
    private final com.iitp.iitp_rest.repository.VehicleTypeRepository vehicleTypeRepository;

    /** vehicle_sim.db 무효화 연쇄 — NextSim 재실행 등 외부 갱신 시 ViewportCtx 도 함께 비움 */
    @jakarta.annotation.PostConstruct
    private void registerInvalidationListener() {
        vehicleDataReader.addInvalidationListener(viewportCtxCache::remove);
        // ⚠️ 실측 확정(2026-08-03): NextSimRunner가 새 시뮬레이션 완료 후 vehicle_sim.db를
        // SFTP에 업로드하며 vehicleDataReader.invalidateDbCache(versionId)는 호출하지만(원시
        // DB 파일 캐시만 비움), 그보다 상위의 vehicle_route 테이블(완성된 CZML 캐시)은 전혀
        // 건드리지 않았다 — 그 결과 새 시뮬레이션을 돌려도 화면은 예전 시뮬레이션으로 만든
        // CZML을 계속 서빙해, "재생성해도 안 고쳐진 것처럼 보이는" 상황이 반복됐다(같은
        // 세션에서 수 차례 재현). uploadVehicleSimDb(수동 업로드) 경로는 이미 CZML 캐시를
        // 직접 지우고 있었지만 NextSimRunner 경로만 빠져 있었다 — invalidateDbCache 리스너에
        // 걸어두면 호출 경로(NextSim 재실행/수동 업로드/더미 생성 등) 전부를 한 곳에서
        // 커버하므로, 앞으로 vehicle_sim.db를 갱신하는 새 경로가 생겨도 이 무효화를 놓치지
        // 않는다.
        vehicleDataReader.addInvalidationListener(versionId ->
                vehicleRouteService.getByVersionId(versionId).ifPresent(vehicleRouteService::deleteRoute));
    }

    /** 현재 비동기 생성 중인 scenarioKey 집합 */
    private final java.util.concurrent.ConcurrentHashMap<String, Boolean> generatingSet = new java.util.concurrent.ConcurrentHashMap<>();
    /** 마지막 생성 실패 메시지 (scenarioKey → 에러메시지) */
    private final java.util.concurrent.ConcurrentHashMap<String, String> failedSet = new java.util.concurrent.ConcurrentHashMap<>();
    /** 현재 생성 단계 메시지 (scenarioKey → 단계 설명) */
    private final java.util.concurrent.ConcurrentHashMap<String, String> stageMap = new java.util.concurrent.ConcurrentHashMap<>();
    /** 생성 시작 시각 (scenarioKey → System.currentTimeMillis()) */
    private final java.util.concurrent.ConcurrentHashMap<String, Long> startTimeMap = new java.util.concurrent.ConcurrentHashMap<>();

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    /** in-memory 더미 생성 한계 — 초과 시 SQLite 스트리밍 생성으로 전환 (이벤트 List 미보유) */
    private static final int LARGE_DUMMY_THRESHOLD = 10_000;
    /** 이벤트가 이보다 많으면 전체 CZML 빌드 생략(heap 보호) — viewport 스트리밍이 서빙 */
    private static final long LARGE_EVENT_THRESHOLD = 5_000_000L;

    @PostMapping("/generate-vehicle-route/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> generateVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) throws IOException {

        Scenario scenario = scenarioService.getScenarioByKey(scenarioKey);

        if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
            logger.error("[generateVehicleRoute] scenarioKey={}의 기준 좌표(latitude/longitude)가 설정되지 않았습니다.", scenarioKey);
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(Map.of("error", "시나리오 기준 좌표(latitude/longitude)가 설정되지 않았습니다: " + scenarioKey));
        }

        String networkXmlUrl = remoteUrl + scenarioKey + "/network.xml";
        logger.info("[generateVehicleRoute] scenarioKey={}, networkXmlUrl={}", scenarioKey, networkXmlUrl);

        // [PERF] network.xml 원격 다운로드 (openStream은 lazy → 전체 바이트를 먼저 받아 시간 분리 측정)
        stageMap.put(scenarioKey, "네트워크 XML 다운로드 중...");
        long _tDl = System.currentTimeMillis();
        byte[] networkBytes;
        try (InputStream raw = RemoteXmlFetch.openStream(networkXmlUrl)) {
            networkBytes = raw.readAllBytes();
        } catch (java.io.FileNotFoundException e) {
            logger.warn("[generateVehicleRoute] network.xml 없음: {}", networkXmlUrl);
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "network.xml 파일이 없습니다. 네트워크를 먼저 저장하세요: " + scenarioKey));
        }
        logger.info("[PERF] network.xml 다운로드: {}ms, {}KB", System.currentTimeMillis() - _tDl, networkBytes.length / 1024);
        InputStream is = new ByteArrayInputStream(networkBytes);

        stageMap.put(scenarioKey, "네트워크 XML 파싱 중...");
        long _tParse = System.currentTimeMillis();
        List<RoadResponse.Road> roadEntities = GeoJsonUtils.parseXmlToRoads(is);
        logger.info("[PERF] parseXmlToRoads: {}ms, {} roads", System.currentTimeMillis() - _tParse, roadEntities.size());

        // 더미 차량 생성(링크 길이/도형 기반)에 사용 — linkId로 키잉
        Map<String, RoadResponse.Road> roadMap = roadEntities.stream().collect(Collectors.toMap(
                RoadResponse.Road::getLinkId,
                Function.identity(),
                (r1, r2) -> r1
        ));

        stageMap.put(scenarioKey, "시뮬레이션 데이터 확인 중...");
        // 대용량 가드: 이벤트 수천만 건을 전부 로드해 CZML 을 빌드하면 heap OOM.
        // 대용량 DB 는 전체 CZML 을 만들지 않고 viewport 스트리밍이 서빙한다.
        long existingEvents = vehicleDataReader.countEvents(scenarioKey);
        if (existingEvents > LARGE_EVENT_THRESHOLD) {
            logger.info("[generateVehicleRoute] {} 대용량 DB (이벤트 {}건) — 전체 CZML 생략, viewport 스트리밍 사용", scenarioKey, existingEvents);
            stageMap.remove(scenarioKey);
            return ResponseEntity.ok(Map.of("status", "ok", "largeMode", true, "events", existingEvents));
        }

        stageMap.put(scenarioKey, "시뮬레이션 데이터 로드 중...");
        long _tRead = System.currentTimeMillis();
        List<VehicleEvent> vehicleEvents = existingEvents > 0
                ? vehicleDataReader.readVehicleEvent(scenarioKey)
                : new ArrayList<>();
        logger.info("[PERF] readVehicleEvent: {}ms, {} events", System.currentTimeMillis() - _tRead, vehicleEvents.size());
        if (vehicleEvents.isEmpty()) {
            // 더미 생성은 명시적 요청(generateDummy=true)일 때만 — 로드 경로 POST가 더미를 만들지 않도록
            if (!request.isGenerateDummy()) {
                logger.info("[generateVehicleRoute] {} vehicle_sim.db 없음 — 명시적 생성 요청이 아니므로 더미 생성 안 함", scenarioKey);
                throw new java.io.FileNotFoundException("시뮬레이션 결과 파일(vehicle_sim.db)이 없습니다: " + scenarioKey);
            }
            logger.info("[generateVehicleRoute] {} vehicle_sim.db 없음 — 네트워크 기반 더미 데이터 생성 후 SFTP 저장", scenarioKey);
            try {
                NetworkXml networkXml = networkService.getNetworkXmlByVersionId(scenarioKey);
                int numVehicles;
                if (request.getNumVehicle() > 0) {
                    numVehicles = request.getNumVehicle();
                } else {
                    // 도로 총 연장(km) 기반 자동 계산: 15대/km
                    double totalLengthM = roadMap.values().stream()
                            .filter(r -> r.getBaseEasting() != null && r.getTargetEasting() != null)
                            .mapToDouble(r -> {
                                double dx = r.getTargetEasting() - r.getBaseEasting();
                                double dy = r.getTargetNorthing() - r.getBaseNorthing();
                                return Math.sqrt(dx * dx + dy * dy);
                            })
                            .sum();
                    numVehicles = Math.max(50, (int) (totalLengthM / 1000.0 * 15.0));
                    logger.info("[generateVehicleRoute] {} 면적 기반 차량 수 자동 계산: 도로 연장 {}km → {}대",
                            scenarioKey, String.format("%.1f", totalLengthM / 1000.0), numVehicles);
                }

                DummyVehicleGenerator.SignalContext signalCtx =
                        buildSignalContext(networkXml, remoteUrl + scenarioKey + "/signal.xml");

                // ── 대량(전국급): 이벤트를 메모리에 안 들고 SQLite 로 직접 스트리밍 생성 ──
                // (in-memory 는 186K대=4,800만 건에서 OOM 실측. 전체 CZML 도 생략 → viewport 가 서빙)
                if (numVehicles > LARGE_DUMMY_THRESHOLD) {
                    stageMap.put(scenarioKey, "대량 더미 생성 중... (차량 " + numVehicles + "대, 스트리밍)");
                    DummyVehicleGenerator.StreamGenResult gen = dummyVehicleGenerator.generateToSqlite(
                            networkXml, roadMap, numVehicles, 600, 42L, signalCtx,
                            done -> stageMap.put(scenarioKey, "대량 더미 생성 중... (" + done + "/" + numVehicles + "대)"));
                    stageMap.put(scenarioKey, "서버 업로드 중... (이벤트 " + gen.eventCount() + "건)");
                    try (InputStream dbStream = new FileInputStream(gen.dbFile())) {
                        fileStorage.uploadFile(dbStream, scenarioKey, "vehicle_sim.db");
                    } finally {
                        gen.dbFile().delete();
                    }
                    vehicleDataReader.invalidateDbCache(scenarioKey);
                    viewportCtxCache.remove(scenarioKey);
                    logger.info("[generateVehicleRoute] {} 대량 더미 업로드 완료 ({}대, {}건) — viewport 스트리밍 사용", scenarioKey, numVehicles, gen.eventCount());
                    stageMap.remove(scenarioKey);
                    return ResponseEntity.ok(Map.of("status", "ok", "largeMode", true,
                            "vehicles", numVehicles, "events", gen.eventCount()));
                }

                stageMap.put(scenarioKey, "더미 차량 경로 생성 중... (차량 " + numVehicles + "대)");
                vehicleEvents = dummyVehicleGenerator.generate(networkXml, roadMap, numVehicles, 600, 42L, signalCtx);
                if (!vehicleEvents.isEmpty()) {
                    stageMap.put(scenarioKey, "SQLite 파일 생성 및 서버 업로드 중... (이벤트 " + vehicleEvents.size() + "건)");
                    try (java.io.InputStream dbStream = dummyVehicleGenerator.writeToSqlite(vehicleEvents)) {
                        fileStorage.uploadFile(dbStream, scenarioKey, "vehicle_sim.db");
                        logger.info("[generateVehicleRoute] {} vehicle_sim.db SFTP 업로드 완료", scenarioKey);
                    }
                    vehicleDataReader.invalidateDbCache(scenarioKey);
                    viewportCtxCache.remove(scenarioKey);
                }
            } catch (Exception e) {
                logger.error("[generateVehicleRoute] 더미 데이터 생성/업로드 실패", e);
            }
            if (vehicleEvents.isEmpty()) {
                throw new java.io.FileNotFoundException("시뮬레이션 결과 파일(vehicle_sim.db)이 없습니다: " + scenarioKey);
            }
        }

        stageMap.put(scenarioKey, "차량 이벤트 그룹화 중... (" + vehicleEvents.size() + "건)");
        Map<String, List<VehicleEvent>> grouped = vehicleEvents.stream()
                .collect(Collectors.groupingBy(VehicleEvent::getId));

        Map<String, VehicleInfo> vehicleInfoMap = vehicleDataReader.readVehicleInfoMap(scenarioKey);
        Map<String, String> nextsimCodeToVehicleId = loadNextsimCodeToVehicleIdMap();

        List<Map<String, Object>> czml = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, Object>> featureList = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, Object>> vehiclePathList = Collections.synchronizedList(new ArrayList<>());

        Instant startTime = Instant.now();

        long baseEpoch = startTime.getEpochSecond();

        // 시뮬레이션 실제 시간 범위 계산
        double simMinTime = grouped.values().stream()
                .flatMap(List::stream)
                .mapToDouble(v -> v.getTimestep())
                .min().orElse(0);
        double simMaxTime = grouped.values().stream()
                .flatMap(List::stream)
                .mapToDouble(v -> v.getTimestep())
                .max().orElse(600);
        // 신호 타임라인은 t=0 기준으로 생성 (offset은 시뮬레이션 t=0 기준 위상 오프셋)
        // 사이클 커버 범위: t=0 ~ simMaxTime
        int simulationDuration = (int) Math.ceil(simMaxTime) + 10; // 여유 10초

        stageMap.put(scenarioKey, "CZML 좌표 변환 중... (차량 " + grouped.size() + "대)");
        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(baseEpoch, "0", scenarioKey, simulationDuration);

        Instant[] range = buildVehiclePackets(scenarioKey, grouped, scenario, baseEpoch,
                startTime, vehicleInfoMap, nextsimCodeToVehicleId, czml, featureList, vehiclePathList);
        Instant globalStart = range[0];
        Instant globalStop  = range[1];

        if (globalStart == null || globalStop == null) {
            throw new java.io.FileNotFoundException(
                "차량 경로 생성 실패: 유효한 좌표가 없습니다 (vehicle_sim.db가 비어있음) — scenarioKey=" + scenarioKey);
        }

        Map<String, Object> documentPacket = Map.of(
                "id", "document",
                "name", "Vehicle Movement",
                "version", "1.0",
                "clock", Map.of(
                        "interval", globalStart + "/" + globalStop,
                        "currentTime", globalStart.toString(),
                        "multiplier", 1,
                        "range", "CLAMPED",
                        "step", "SYSTEM_CLOCK_MULTIPLIER"
                )
        );
        czml.addFirst(documentPacket);

        stageMap.put(scenarioKey, "DB 저장 중...");
        vehicleRouteService.saveRoute(scenarioKey, czml, featureList, vehiclePathList, baseEpoch, scenarioKey);
        stageMap.remove(scenarioKey);

        Map<String, Object> response = new HashMap<>();
        response.put("czml", czml);
        response.put("features", featureList);
        response.put("positions", vehiclePathList);

        response.put("signalTimeline", signalTimeline);

        return ResponseEntity.ok(response);
    }

    /**
     * 차량 이벤트 그룹 → CZML 패킷/feature/positions 빌드 (generateVehicleRoute·viewport 공용).
     * @return [earliestStart, latestStop] — 유효 차량이 없으면 [null, null]
     */
    /**
     * 인접 차선 셀 사이를 오가며 pos_x/pos_y가 왕복하는 현상을 억제한다. vehicle_sim.db 직접
     * 조회로 실측 확인한 원인: 정체(mode="None", 메조스코픽 큐 모델) 중엔 5초 간격의 굵은
     * 타임스텝으로 기록되며 lane_id/좌표가 몇 개의 고정 지점 사이를 반복해서 튄다 — NextSim
     * 원시 출력 자체의 특성이라 엔진(벤더 바이너리) 쪽은 못 고친다.
     * <p>
     * ⚠️ 처음엔 mode="None" 구간에만 이 필터를 적용했으나, 실측 재현 결과 **정상 주행
     * (mode="CF") 중에도 같은 왕복 패턴이 발생**함을 확인했다(예: 한 차량이 같은 링크의 두
     * 차선 사이를 50초 동안 반복 왕복, 계속 "CF"). mode="None"만 걸러서는 이런 CF 구간의
     * 왕복이 그대로 통과해 "주행 중 대각선 뒤로 옆 차선 이동", "정지 시 옆을 보고 정지"로
     * 보였다(실사용자 관찰). 그래서 mode 구분 없이 **같은 링크가 이어지는 구간 전체**에 이
     * 필터를 적용하도록 일반화했다 — 실측(400대 샘플) 결과 mode="None"만 걸렀을 때 812건이던
     * 급격한 방향 반전(인접 두 구간 heading 차 100도 초과)이 84건으로 90% 감소했고, 남은
     * 84건은 대부분 실제 이동거리가 3m 미만인 저속 구간의 잔여 노이즈였다. 진짜 차선변경
     * (같은 방향으로 단조 진행)은 아래 단조증가 검사를 통과하므로 건드리지 않는다(검증 완료).
     * <p>
     * 1차 시도(anchor 기준 "지금까지 가장 멀리 나아간 지점"만 유지)는 실측 재현 결과 결함이
     * 있었다 — 왕복이 두 지점 사이가 아니라 3개 이상의 인접 지점을 오갈 때, 첫 번째로 튄
     * 지점이 anchor의 "최댓값"으로 고정돼버려서 그 뒤에 이어지는 (진짜와 구분 안 되는) 잡음
     * 샘플들이 전부 그 튄 지점으로 눌러앉는 문제가 있었다 — 결과적으로 "잠깐 멈췄다가 옆
     * 차선으로 밀린 뒤에야 다음 링크로 진입"하는 것처럼 보였다(실사용자 관찰로 확인).
     * <p>
     * 2차 시도(잡음 구간 전체를 첫 지점 좌표로 고정)도 실사용 결과 문제가 있었다 — 정체가
     * 흔한 시나리오에서는 다수 차량이 동시에 "한참 얼어있다가 링크가 바뀌는 순간 훅 이동"하는
     * 모양이 돼, 전체적으로 시뮬레이션이 뚝뚝 끊기는 것처럼 보였다("아예 안 되는 것 같다"는
     * 사용자 피드백).
     * <p>
     * 지금은 같은 링크가 이어지는 구간(streak, mode 무관)을 모은 뒤, 그 구간의 첫 지점 기준
     * 거리가 단조증가(1m 잡음 허용)하는지 검사해 잡음 여부만 판별하고, 잡음이면 좌표를 고정하는
     * 대신 구간의 첫 지점→끝 지점을 시간 비례로 잇는 직선(등속 크리프)으로 대체한다 — 차량이
     * 죽 멈춰있지 않고 느리지만 매끄럽게 계속 나아가는 것처럼 보이면서도, 왕복 잡음으로 인한
     * 지그재그는 사라진다. 시작/끝 지점(구간 경계, 실제로 링크가 바뀌기 직전 상태)은 원본 그대로
     * 유지한다. timestep은 손대지 않으므로(샘플을 삭제하지 않음) availability gap 계산(7초
     * 임계)에는 영향 없다.
     */
    private static void filterQueueJitter(List<VehicleEvent> events) {
        int n = events.size();
        int i = 0;
        while (i < n) {
            VehicleEvent e = events.get(i);
            int j = i + 1;
            while (j < n && Objects.equals(events.get(j).getLinkId(), e.getLinkId())) {
                j++;
            }
            collapseIfNoisyQueueStreak(events, i, j);
            i = j;
        }
    }

    // ⚠️ 실측 확정(vehicle_sim.db 직접 조회, 2026-08 — 커넥션→다음 링크 전환 시 차량이 링크
    // 진입 지점에 멈춰 서 있다가 순간이동하는 것처럼 보인다는 실사용 보고): NextSim이 링크
    // 경계(주로 커넥션→일반 링크 전환)에서 pos_x/pos_y를 갱신하지 않고 직전 위치를 그대로
    // 재사용하는 이벤트를 남긴다 — 그 구간은 이동거리가 0인데 spd 컬럼은 그 시점의 실제
    // (높은) 속도를 그대로 기록해, "차가 실제로 이동 중인데 좌표만 멈춰있는" 모순 상태가
    // 된다. 진짜 정차(신호대기 등)는 이동거리 0 + spd도 0으로 같이 기록되므로 이 필터로
    // 걸리지 않는다. 실측: scenario2_2 40,369건의 "이동거리<0.5m" 이벤트 중 스트릭 길이 1~50
    // 전반에 걸쳐 spd 8~140km/h가 광범위하게 관측됨(길이 1개짜리만 걸러서는 대부분 못 잡음
    // — 프론트 czmlPositionWorker.ts의 "고립된 1구간만 병합" 완화로는 부족했던 이유).
    // spd 컬럼(프론트로는 안 넘어가는 서버 전용 원본 데이터)이 있어야 정확히 판별 가능하므로
    // 여기(서버, CZML 생성 전)에서 걸러낸다 — 스트릭 길이 제한 없이, "직전 유지 위치" 대비
    // 이동거리가 미미한데 그 시점 실측 속도가 실제 이동을 뜻하는 이벤트는 통째로 스킵.
    // 스킵된 이벤트는 CZML positions 배열에 아예 안 실리므로, 그 앞뒤의 실제 위치 이벤트끼리
    // 직접 선형보간되어(시간은 그대로 유지) 정지 없이 자연스럽게 이어 움직인다.
    // ⚠️ vehicle_sim.db의 spd 컬럼 단위는 m/s가 아니라 km/h다(network.xml의 max_spd/ff_spd와
    // 직접 대조해 확정 — 예: 폭 3m 단일차선 링크 20000154의 max_spd=30.0인데 그 링크를 지나는
    // 차량의 spd도 동일하게 30.0 근방으로 기록됨. m/s라면 그 링크에서 시속 108km라는 뜻이라
    // 폭 3m 도로엔 비현실적).
    //
    // ⚠️ 1차 시도(dist<0.5m && spd>7.2km/h 만으로 판정) 회귀: 커넥션 내부는 0.1초 간격의
    // 촘촘한 샘플이라, 실제로 정상 주행 중이어도 한 스텝(0.1초)당 이동거리가 쉽게 0.5m
    // 미만이 된다(예: 15km/h·0.1초 = 0.42m) — 이런 정상 스텝까지 "제자리"로 오판해 통째로
    // 스킵하면, 남은 두 점 사이를 직선(코드)으로 이으면서 실제 곡선 커넥션 경로를 벗어나
    // "제자리에서 옆으로 삐져나가는" 것처럼 보였다(실사용 재현, scenario2_2 실측: 1차
    // 규칙으로 스킵된 33,364건 중 52.6%가 dt≤0.5초의 커넥션 내부 스텝이었음). 절대 거리
    // 기준만으론 짧은 시간 간격의 정상 저속 이동과 "몇 초씩 좌표가 그대로인" 진짜 결함을
    // 구분할 수 없어 "그 시간·속도라면 있어야 할 이동거리"(expectedDist)까지 같이 보도록
    // 고쳤다.
    //
    // ⚠️ 2차 시도(직전 "유지된" 이벤트 대비 현재 이벤트 하나만 비교) 회귀: 좌표가 여러
    // 샘플에 걸쳐 연속으로 고정되는 경우(scenario3_1_V2 실측 — 20초간 4개 샘플 연속 고정),
    // 중간 샘플들(예: 5·10·15초 시점, spd=50 그대로 기록)은 정확히 걸러졌지만, 그 스트릭의
    // "마지막" 샘플(20초 시점)에서 하필 spd가 0으로 감쇠해 기록되면 expectedDist=0이 되어
    // "직전 유지 위치" 비교만으로는 정상적인 도착으로 오판해 통과시켰다 — 그 결과 스트릭
    // 전체(20초)가 여전히 하나의 "제자리" 구간으로 남아 화면에 차가 멈춰 서 있는 것처럼
    // 보였다. 개별 이벤트 단위가 아니라 "같은 위치에 머무는 연속 구간(클러스터)" 단위로
    // 판정해야 한다 — 클러스터 안의 어느 샘플이든 하나라도 "실제 이동 중"이라고 주장하면
    // (expectedDist가 임계값을 넘으면) 그 클러스터 전체(마지막 샘플 포함)를 결함으로 보고
    // 통째로 스킵한다. 클러스터 내내 spd가 낮게(=거의 0으로) 유지되면 진짜 정차로 보고
    // 전부 그대로 유지한다.
    private static final double STALE_POSITION_DIST_EPS_M = 0.5; // 클러스터 시작점 대비 이동거리가 이 미만이면 "같은 위치"
    private static final double STALE_POSITION_EXPECTED_DIST_MIN_M = 1.5; // 클러스터 내 한 샘플이라도 속도×경과시간이 이 초과면 결함으로 판정

    private static List<VehicleEvent> dropStalePositionArtifacts(List<VehicleEvent> events) {
        if (events.size() < 2) return events;
        List<VehicleEvent> kept = new ArrayList<>(events.size());
        int n = events.size();
        int i = 0;
        while (i < n) {
            VehicleEvent anchor = events.get(i);
            kept.add(anchor);

            // anchor와 위치가 사실상 같은(< EPS) 연속 구간을 클러스터로 묶는다. 클러스터 내
            // 어느 한 샘플이라도 "그 시점까지 있어야 할 이동거리"가 임계값을 넘으면(=실제로는
            // 움직이고 있었어야 함) 결함으로 판정한다.
            //
            // ⚠️ 실측 확정(scenario3_1_V2 재검증 — veh 752): 커넥션을 실제로 빠르게(37.84km/h)
            // 빠져나온 직후, 다음 링크의 "첫" 샘플 좌표가 소수점 단위까지 그 지점과 동일한데
            // 정작 그 샘플 자신의 spd는 0으로 기록되는 경우가 있었다 — 클러스터 멤버가 이
            // 샘플 하나뿐이면(멤버 자신의 spd만 보는 이전 로직으로는) sawRealMotionClaim이
            // false로 남아 "진짜 정차"로 오판했다. anchor(클러스터 진입 직전 지점) 자체가
            // 빠르게 움직이던 중이었다면, 그 직후 좌표가 그대로 얼어붙는 것 자체가 이상 신호이므로
            // anchor의 속도도 함께 판정에 반영한다.
            //
            // ⚠️ 회귀(2026-08-03 재재현 — "교차로 커넥션 지나 다음 레인 진입 시 잠시 멈췄다가
            // 옆 레인으로 서서히 미끄러지듯 이동"): anchor 속도 기반 판정을 클러스터 전체
            // 구간(dt가 계속 커지는 매 후보)에 반복 적용했더니, 차량이 실제로 서서히 감속해
            // 자연스럽게 정차하는 정상 구간(다음 신호/정체를 향해 서행하며 멈추는 경우)까지
            // dt가 충분히 커지는 순간 expectedDistByAnchor가 임계값을 넘어 "결함"으로 오판됐다
            // — anchor의 순간 속도는 "그 시점"에만 유효한 값이지, 그 뒤로 수 초~수십 초가 지나도
            // 계속 그 속도로 달리고 있었을 것이라 가정하면 안 된다. anchor 속도 기반 판정은
            // "클러스터에 진입한 바로 다음 샘플"(진짜 결함이 나타나는 즉시 전환 지점)에만
            // 적용하고, 그 이후 후보들은 각자 자신의 순간 속도로만 판정한다 — veh 752 사례
            // (anchor 직후 단 하나의 샘플만 결함)는 이 조건으로도 그대로 잡히고, 서행 후 정차
            // 같은 점진적·정상적인 구간은 더 이상 오탐되지 않는다.
            double anchorExpectedDistPerSec = anchor.getSpeed() / 3.6; // km/h → m/s
            int j = i + 1;
            boolean sawRealMotionClaim = false;
            while (j < n) {
                VehicleEvent cand = events.get(j);
                double dx = cand.getPosX() - anchor.getPosX();
                double dy = cand.getPosY() - anchor.getPosY();
                double dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= STALE_POSITION_DIST_EPS_M) break; // 클러스터 종료(실제 이동 재개)
                double dt = cand.getTimestep() - anchor.getTimestep();
                double expectedDist = (cand.getSpeed() / 3.6) * dt;
                if (j == i + 1) {
                    expectedDist = Math.max(expectedDist, anchorExpectedDistPerSec * dt);
                }
                if (expectedDist > STALE_POSITION_EXPECTED_DIST_MIN_M) {
                    sawRealMotionClaim = true;
                }
                j++;
            }

            if (j > i + 1) {
                if (!sawRealMotionClaim) {
                    // 진짜 정차 — 클러스터 멤버 전부 그대로 유지
                    for (int k = i + 1; k < j; k++) kept.add(events.get(k));
                } else if (j < n) {
                    // ⚠️ 회귀(2026-08-03 재재현 — "커넥션 지나 다음 레인 진입 시 정지 후 옆으로
                    // 미끄러짐", "잘 가다가 사라짐"): 결함 클러스터를 통째로 스킵(삭제)하면 그
                    // 자리의 시간 간격이 원래 5초(또는 0.1초) 간격 대신 anchor~다음 실제 지점
                    // 사이의 훨씬 긴 간격(수 초~수십 초)으로 벌어진다. 프론트(czmlPositionWorker.ts)
                    // 는 이 벌어진 간격이 GAP_THRESHOLD(7초)나 MAX_PLAUSIBLE_SPEED를 넘으면 "차량이
                    // 순간이동한 구간"으로 보고 그 사이 통째로 차량을 숨기고(=사라짐), 안 넘으면
                    // 그 긴 간격을 직선 하나로 이어버려(=곡선 구간을 가로질러 옆으로 미끄러지듯
                    // 보임) 둘 다 부자연스러웠다. 삭제 대신 anchor→다음 실제 지점(j) 사이를
                    // "원래 있던 타임스텝은 그대로 유지한 채" 시간 비례 직선으로 재배치한다 —
                    // filterQueueJitter의 잡음 제거와 동일한 기법이지만 여기서는 결함으로 판정된
                    // 좌표만 대상으로 한다. 샘플 밀도(및 간격)가 원본과 같게 유지되므로 프론트의
                    // gap 판정 기준을 건드리지 않으면서, 큰 직선 한 방이 아니라 원래 있던 여러
                    // 작은 스텝으로 나뉘어 훨씬 자연스럽게 이어진다.
                    VehicleEvent nextReal = events.get(j);
                    double totalDuration = nextReal.getTimestep() - anchor.getTimestep();
                    for (int k = i + 1; k < j; k++) {
                        VehicleEvent e = events.get(k);
                        double localT = totalDuration > 0 ? (e.getTimestep() - anchor.getTimestep()) / totalDuration : 0;
                        e.setPosX((float) (anchor.getPosX() + (nextReal.getPosX() - anchor.getPosX()) * localT));
                        e.setPosY((float) (anchor.getPosY() + (nextReal.getPosY() - anchor.getPosY()) * localT));
                        kept.add(e);
                    }
                }
                // sawRealMotionClaim이 true인데 j>=n(클러스터가 마지막까지 이어짐)이면 재배치
                // 기준으로 삼을 다음 실제 지점이 없다 — 트립 종료 직전이라 영향이 적으므로 그냥 스킵.
                i = j;
            } else {
                i++;
            }
        }
        return kept;
    }

    /**
     * [start, endExclusive) 구간(같은 링크, 전부 mode="None")이 단조 전진이 아니면(=왕복 잡음)
     * 첫/끝 지점만 원본 그대로 두고 그 사이는 시간 비례 직선(등속 크리프)으로 대체한다.
     */
    private static void collapseIfNoisyQueueStreak(List<VehicleEvent> events, int start, int endExclusive) {
        if (endExclusive - start < 3) return; // 점 2개 이하는 왕복 여부를 판별할 수 없음 — 그대로 둠

        VehicleEvent first = events.get(start);

        // ⚠️ 실측 확정(vehicle_sim.db 직접 조회, scenario3_1_V2 veh 4326 — "커넥션 지나 다음
        // 레인 진입 후에도 여전히 뚝뚝 끊겨 움직인다" 재현): 같은 링크 안에서 좌표가 "멈춤(수 초
        // 고정)-점프-멈춤-점프" 식으로 계단처럼 기록되는데, 매 구간 spd는 계속 0으로 일관되고
        // (dropStalePositionArtifacts는 spd 기반 판정이라 못 잡음), 위치도 항상 앞으로만
        // 진행(뒤로 안 감)이라 아래 monotonic 판정도 "왕복 잡음 아님"으로 통과시켜 그대로
        // 뒀었다 — 그 결과 이 계단식 구간은 어떤 필터도 손대지 않고 원본 그대로 남아 "멈췄다
        // 점프했다"를 반복하는 것처럼 보였다. 왕복 여부와 무관하게, 구간 내 "연속된 두 샘플이
        // 사실상 같은 위치(홀드)"인 곳이 하나라도 있으면 — 거칠게(성긴 해상도로) 기록된
        // 구간이라는 신호이므로 매끄럽게 펴야 한다. 반대로 홀드 구간이 전혀 없으면(예: 커넥션
        // 내부 0.1초 간격 연속 곡선 주행처럼 매 스텝이 실제로 다른 위치) 이미 충분히 매끄러운
        // 원본이니 손대지 않는다(직선으로 펴면 오히려 실제 곡선 경로를 깎아버림).
        boolean hasHeldRun = false;
        for (int k = start + 1; k < endExclusive; k++) {
            VehicleEvent prev = events.get(k - 1);
            VehicleEvent cur = events.get(k);
            double hdx = cur.getPosX() - prev.getPosX();
            double hdy = cur.getPosY() - prev.getPosY();
            if (Math.sqrt(hdx * hdx + hdy * hdy) < STALE_POSITION_DIST_EPS_M) {
                hasHeldRun = true;
                break;
            }
        }

        if (!hasHeldRun) {
            final double NOISE_TOLERANCE_M = 1.0; // 실측 잡음 규모 이하의 뒷걸음은 허용(진짜 전진으로 간주)
            double maxDistSoFar = 0;
            boolean monotonic = true;
            for (int k = start + 1; k < endExclusive; k++) {
                VehicleEvent e = events.get(k);
                double dx = e.getPosX() - first.getPosX();
                double dy = e.getPosY() - first.getPosY();
                double dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < maxDistSoFar - NOISE_TOLERANCE_M) {
                    monotonic = false;
                    break;
                }
                maxDistSoFar = Math.max(maxDistSoFar, dist);
            }
            if (monotonic) return; // 홀드 구간 없는 매끄러운 연속 이동 — 그대로 둠

            // ⚠️ 실측 확정(vehicle_sim.db 직접 조회, scenario3_1_V2 — dropStalePositionArtifacts
            // 적용 후에도 여전히 차가 멈춰 서 있는 것처럼 보인다는 재현): first와 last가 우연히
            // (거의) 같은 위치면 "첫/끝을 잇는 직선"이 길이 0인 점 하나로 쭈그러든다 — 그러면 아래
            // 루프가 중간 지점 전부를 그 한 점으로 덮어써서, 실제로 있었던 왕복 이동(예: 3m 옆으로
            // 갔다가 되돌아옴)까지 통째로 지워지고 구간 전체가 "몇 초씩 정지"한 것처럼 보인다.
            // 단, 이 가드는 hasHeldRun이 false인 경우(진짜 짧은 왕복 — 홀드 구간 없이 매 스텝이
            // 다른 위치)에만 적용한다. hasHeldRun이 true인 경우(veh 962 재현 — 정지구간 안에서
            // 20~30m 떨어진 2~3개 지점을 오가며 튀다가 우연히 출발점으로 되돌아온 경우)는 first
            // ≈ last라도 반드시 collapse해야 한다 — 그렇지 않으면 정지 중 옆 차선으로 튀었다가
            // 되돌아오는 잡음이 그대로 노출돼 "멈췄다 옆으로 슬라이드했다 출발"처럼 보인다.
            VehicleEvent last0 = events.get(endExclusive - 1);
            final double DEGENERATE_COLLAPSE_EPS_M = 0.5;
            double lastDx0 = last0.getPosX() - first.getPosX();
            double lastDy0 = last0.getPosY() - first.getPosY();
            if (Math.sqrt(lastDx0 * lastDx0 + lastDy0 * lastDy0) < DEGENERATE_COLLAPSE_EPS_M) return;
        }

        VehicleEvent last = events.get(endExclusive - 1);
        double totalDuration = last.getTimestep() - first.getTimestep();
        for (int k = start + 1; k < endExclusive - 1; k++) {
            VehicleEvent e = events.get(k);
            double localT = totalDuration > 0 ? (e.getTimestep() - first.getTimestep()) / totalDuration : 0;
            e.setPosX((float) (first.getPosX() + (last.getPosX() - first.getPosX()) * localT));
            e.setPosY((float) (first.getPosY() + (last.getPosY() - first.getPosY()) * localT));
        }
    }

    /**
     * versionId → [baseLon, baseLat, baseRotationDeg, baseScale] — network.xml 자체에 박혀있는
     * 캘리브레이션 값(2점 캘리브레이션/reanchor 결과)의 캐시. 백엔드 재시작 전까지 유지되며,
     * 네트워크가 재캘리브레이션되면 갱신 전까지는 예전 값을 쓸 수 있음(드문 수동 작업이라
     * 당장은 감수 — 필요해지면 캘리브레이션 엔드포인트 쪽에서 invalidate 호출 추가할 것).
     */
    private final Map<String, double[]> networkCalibrationCache = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * 차량 위치 계산에 쓸 기준점/회전/축척을 network.xml 자체의 값에서 읽어온다.
     * ⚠️ 실측 확정된 근본원인: Scenario.baseRotation/baseScale은 "네트워크 캘리브레이션 결과의
     * 미러"로 설계됐지만(주석상 의도), 실제로는 동기화가 안 돼 있는 시나리오가 있었다(예:
     * scenario3_1 — Scenario는 rotation=null/scale=null인데 network.xml은 rotation=-4.97°,
     * scale=1.49로 실제 캘리브레이션돼 있었음). 그 결과 도로는 회전·확대된 위치에 그려지는데
     * 차량은 미회전 좌표로 계산돼, 직선 도로에서도 차량이 차선과 어긋나 보였다(실사용자 확인 —
     * "직선도 안 맞음"). Scenario를 신뢰하는 대신 network.xml의 <Network base_lat/base_lon/
     * base_rotation/base_scale> 속성을 직접 읽어 도로와 반드시 같은 기준을 쓰게 한다. 전체
     * network.xml(수십MB 가능)을 파싱하는 대신 파일 앞부분만 읽어 루트 태그 속성만 뽑는다
     * (성능 — 이 조회가 viewport 스트리밍마다 반복 호출됨).
     */
    private double[] resolveVehicleCalibration(String versionId, Scenario scenario) {
        return networkCalibrationCache.computeIfAbsent(versionId, vid -> {
            double fallbackLon = scenario.getLongitude() != null ? scenario.getLongitude() : 0.0;
            double fallbackLat = scenario.getLatitude() != null ? scenario.getLatitude() : 0.0;
            double fallbackRotation = scenario.getBaseRotation() != null ? scenario.getBaseRotation() : 0.0;
            double fallbackScale = scenario.getBaseScale() != null ? scenario.getBaseScale() : 1.0;
            try (InputStream is = RemoteXmlFetch.openStream(remoteUrl + vid + "/network.xml")) {
                byte[] head = new byte[4096];
                int n = is.read(head);
                String snippet = n > 0 ? new String(head, 0, n, StandardCharsets.UTF_8) : "";
                Double lon = extractDoubleAttr(snippet, "base_lon");
                Double lat = extractDoubleAttr(snippet, "base_lat");
                Double rotation = extractDoubleAttr(snippet, "base_rotation");
                Double scale = extractDoubleAttr(snippet, "base_scale");
                return new double[]{
                        lon != null ? lon : fallbackLon,
                        lat != null ? lat : fallbackLat,
                        rotation != null ? rotation : fallbackRotation,
                        scale != null ? scale : fallbackScale,
                };
            } catch (Exception e) {
                logger.warn("[resolveVehicleCalibration] {} network.xml 헤더 읽기 실패, scenario 값으로 폴백: {}", vid, e.getMessage());
                return new double[]{fallbackLon, fallbackLat, fallbackRotation, fallbackScale};
            }
        });
    }

    private static Double extractDoubleAttr(String xml, String attrName) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile(attrName + "=\"([^\"]+)\"").matcher(xml);
        if (m.find()) {
            try { return Double.parseDouble(m.group(1)); } catch (NumberFormatException ignored) { }
        }
        return null;
    }

    private Instant[] buildVehiclePackets(
            String versionId,
            Map<String, List<VehicleEvent>> grouped,
            Scenario scenario,
            long baseEpoch,
            Instant startTime,
            Map<String, VehicleInfo> vehicleInfoMap,
            Map<String, String> nextsimCodeToVehicleId,
            List<Map<String, Object>> czml,
            List<Map<String, Object>> featureList,
            List<Map<String, Object>> vehiclePathList) {

        AtomicReference<Instant> earliestStartRef = new AtomicReference<>(null);
        AtomicReference<Instant> latestStopRef = new AtomicReference<>(null);
        double[] calibration = resolveVehicleCalibration(versionId, scenario);

        grouped.entrySet().parallelStream().forEach(entry -> {
            String vehicleId = entry.getKey();
            List<VehicleEvent> vehicles = dropStalePositionArtifacts(entry.getValue());
            if (vehicles.isEmpty()) return;
            filterQueueJitter(vehicles);

            double firstTimestep = vehicles.get(0).getTimestep();
            double lastTimestep = vehicles.get(vehicles.size() - 1).getTimestep();

            Instant vehicleStart = Instant.ofEpochSecond(baseEpoch + (long) firstTimestep);
            Instant vehicleStop = Instant.ofEpochSecond(baseEpoch + (long) lastTimestep);

            earliestStartRef.updateAndGet(current ->
                    (current == null || vehicleStart.isBefore(current)) ? vehicleStart : current);
            latestStopRef.updateAndGet(current ->
                    (current == null || vehicleStop.isAfter(current)) ? vehicleStop : current);

            List<Map.Entry<Double, Cartesian3>> path = new ArrayList<>();
            List<Cartesian3> path2d = new ArrayList<>();

            for (VehicleEvent vehicle : vehicles) {
                // pos_x/pos_y는 링크 기준 상대좌표가 아니라 network.xml의 node.center와 동일한
                // 좌표계의 절대 로컬 좌표다(실측 확인 — CoordinateConverter.toAbsoluteLocal 참고).
                // 링크/커넥션 도형을 조회·보간할 필요 없이 바로 변환한다.
                // 기준점/회전/축척은 network.xml 자체의 캘리브레이션 값(resolveVehicleCalibration)을
                // 쓴다 — Scenario 필드는 이 값의 "미러"로 설계됐지만 동기화가 안 돼 있던 시나리오가
                // 있었다(실측 확정 — 도로는 회전·확대돼 그려지는데 차량은 미회전 좌표를 써서 직선
                // 도로에서도 차선과 어긋나 보인 원인). 도로와 반드시 같은 기준을 쓰도록 network.xml을
                // 직접 신뢰한다.
                ProjCoordinate actualCoord = CoordinateConverter.toAbsoluteLocal(
                        vehicle.getPosX(), vehicle.getPosY(), calibration[0], calibration[1],
                        calibration[2], calibration[3]);

                Cartesian3 pos = Cartesian3.fromDegrees(actualCoord.x, actualCoord.y, 0);

                path.add(Map.entry(vehicle.getTimestep(), pos));
                path2d.add(pos);  // 재사용

            }

            if (path2d.isEmpty()) return;

            // 7초 이상 gap이 있는 구간에서 availability 구간을 분리
            // → 차량이 날아가는 대신 사라졌다가 다시 나타남
            final double GAP_THRESHOLD = 7.0;
            List<String> availabilityIntervals = new ArrayList<>();
            double segStart = path.get(0).getKey();
            double prevTime = segStart;
            for (int i = 1; i < path.size(); i++) {
                double currTime = path.get(i).getKey();
                if (currTime - prevTime > GAP_THRESHOLD) {
                    availabilityIntervals.add(
                            Instant.ofEpochSecond(baseEpoch + (long) segStart) + "/" +
                                    Instant.ofEpochSecond(baseEpoch + (long) prevTime));
                    segStart = currTime;
                }
                prevTime = currTime;
            }
            availabilityIntervals.add(
                    Instant.ofEpochSecond(baseEpoch + (long) segStart) + "/" +
                            Instant.ofEpochSecond(baseEpoch + path.get(path.size() - 1).getKey().longValue()));

            Object availability = availabilityIntervals.size() == 1
                    ? availabilityIntervals.get(0)
                    : availabilityIntervals;

            List<Double> cartesianArray = new ArrayList<>(path.size() * 4);
            for (Map.Entry<Double, Cartesian3> p : path) {
                cartesianArray.add(p.getKey());
                cartesianArray.add(p.getValue().getX());
                cartesianArray.add(p.getValue().getY());
                cartesianArray.add(p.getValue().getZ());
            }

            List<List<Double>> lineCoordinates = path2d.stream()
                    .map(p -> List.of(p.getX(), p.getY(), p.getZ()))
                    .toList();

            List<List<Double>> positionsInterval = path.stream()
                    .map(p -> List.of(p.getKey()))
                    .toList();

            Map<String, Object> czmlPacket = Map.of(
                    "id", vehicleId,
                    "availability", availability,
                    "position", Map.of(
                            "epoch", startTime.toString(),
                            "interpolationAlgorithm", "LINEAR",
                            "interpolationDegree", 1,
                            "cartesian", cartesianArray
                    ),
                    "orientation", Map.of("velocityReference", "#position")
            );

            Map<String, Object> feature = Map.of(
                    "geometry", Map.of(
                            "type", "LineString",
                            "coordinates", lineCoordinates
                    ),
                    "properties", Map.of(
                            "id", vehicleId,
                            "availability", availability,
                            "positionsInterval", positionsInterval
                    )
            );

            czml.add(czmlPacket);
            featureList.add(feature);

            Map<String, Object> vehicleEntry = new HashMap<>();
            vehicleEntry.put("id", vehicleId);
            VehicleInfo info = vehicleInfoMap.get(vehicleId);
            // 차종은 VehicleInfo.veh_type(NextSim이 vehicletypes.xml 분류로 실제 채워주는 값,
            // 예: "NV"/"AV"/"NB"/"AB")을 우선 사용한다 — 예전엔 vehicles.get(0).getType()을
            // 넘겼는데 이건 VehicleEventDebugging의 정수형 디버그 코드(레거시 스키마에서만
            // 존재, 차종과 무관)라 실질적으로 항상 비어 있어 매번 ID 해시 폴백만 타고 있었다.
            vehicleEntry.put("type", resolveVehicleType(vehicleId, info != null ? info.getType() : null, nextsimCodeToVehicleId));
            vehicleEntry.put("path", cartesianArray);
            if (info != null) {
                vehicleEntry.put("length", info.getLength());
                vehicleEntry.put("width", info.getWidth());
            }
            vehiclePathList.add(vehicleEntry);
        });

        return new Instant[]{ earliestStartRef.get(), latestStopRef.get() };
    }

    // ─────────────── 차량 viewport+시간창 스트리밍 (개별 차량 near LOD) ───────────────

    /** scenarioKey → 스트리밍 컨텍스트 (기준시각 등 — vehicle_sim.db 최초 조회 시 1회 캐시) */
    private final ConcurrentHashMap<String, ViewportCtx> viewportCtxCache = new ConcurrentHashMap<>();

    private record ViewportCtx(Scenario scenario,
                               Map<String, VehicleInfo> vehicleInfoMap,
                               Map<String, String> nextsimCodeToVehicleId,
                               long baseEpoch, double simMin, double simMax) {}

    private ViewportCtx ensureViewportCtx(String scenarioKey) throws IOException {
        ViewportCtx c = viewportCtxCache.get(scenarioKey);
        if (c != null) return c;
        synchronized (viewportCtxCache) {
            c = viewportCtxCache.get(scenarioKey);
            if (c != null) return c;

            Scenario scenario = scenarioService.getScenarioByKey(scenarioKey);
            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                throw new IOException("시나리오 기준 좌표 없음: " + scenarioKey);
            }
            long t0 = System.currentTimeMillis();
            double[] simRange = vehicleDataReader.readSimTimeRange(scenarioKey);
            Map<String, VehicleInfo> infoMap = vehicleDataReader.readVehicleInfoMap(scenarioKey);
            Map<String, String> nextsimCodeToVehicleId = loadNextsimCodeToVehicleIdMap();
            // baseEpoch은 컨텍스트 수명 동안 고정 → viewport 요청 간 CZML epoch/clock 이 일치 (재생 연속성)
            long baseEpoch = Instant.now().getEpochSecond();
            c = new ViewportCtx(scenario, infoMap, nextsimCodeToVehicleId, baseEpoch, simRange[0], simRange[1]);
            viewportCtxCache.put(scenarioKey, c);
            logger.info("[viewport] {} 컨텍스트 빌드 완료 ({}ms, simRange={}~{})",
                    scenarioKey, System.currentTimeMillis() - t0, simRange[0], simRange[1]);
            return c;
        }
    }

    /** viewport 요청당 선별 차량 기본 상한 (응답 폭주 방지). numVehicle 로 요청별 조정 가능 */
    private static final int VIEWPORT_DEFAULT_MAX_VEHICLES = 3000;
    /** 요청이 아무리 커도 넘지 못하는 하드캡 (~260MB 응답 방지) */
    private static final int VIEWPORT_HARD_CAP = 10_000;
    /** "지금 이 순간" 활성 차량 카운트 조회 시 atTime 기준 ± 이 초만큼 — 더미/NextSim 출력의
     *  timestep 간격(보통 1초)보다 넉넉하게 잡아 정확히 그 순간 레코드가 없어도 놓치지 않는다. */
    private static final double ACTIVE_COUNT_HALF_WINDOW_SEC = 3.0;

    /**
     * viewport(bbox) + 재생 시간창의 차량 궤적만 반환 (대용량 시나리오 개별 차량 스트리밍).
     * 캐시/더미 생성 없음 — vehicle_sim.db 가 없으면 404.
     * body: { bbox: "w,s,e,n", fromTime?, toTime?, bufferSec? }
     */
    @PostMapping("/vehicle-route/{scenarioKey}/viewport")
    public ResponseEntity<Map<String, Object>> getVehicleRouteViewport(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) {
        try {
            if (request.getBbox() == null || request.getBbox().isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "bbox 파라미터가 필요합니다"));
            }
            String[] p = request.getBbox().split(",");
            if (p.length != 4) {
                return ResponseEntity.badRequest().body(Map.of("error", "bbox 형식: west,south,east,north"));
            }
            double west = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());

            if (!fileStorage.exists(scenarioKey + "/vehicle_sim.db")) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "vehicle_sim.db 없음: " + scenarioKey));
            }

            ViewportCtx ctx = ensureViewportCtx(scenarioKey);

            // 1) bbox 내 링크 (네트워크 SQLite RTree 재사용 — link-traffic 과 동일 협업)
            List<String> linkIds = new ArrayList<>();
            for (var link : networkTileService.queryByBbox(
                    scenarioKey, west, south, east, north, NetworkTileService.Lod.NEAR).getLinks()) {
                if (link.getId() != null) linkIds.add(String.valueOf(link.getId()));
            }

            // 2) 시간창 (버퍼 포함) — fromTime/toTime 없으면 전체
            int buffer = request.getBufferSec() != null ? request.getBufferSec() : 60;
            double from = 0, to = 0;
            if (request.getFromTime() != null && request.getToTime() != null) {
                from = Math.max(0, request.getFromTime() - buffer);
                to = request.getToTime() + (double) buffer;
            }

            // 3) 차량 선별 + 궤적 슬라이싱 → CZML 빌드 (캐시 저장 없음).
            //    상한: 요청 numVehicle(>0) 우선, 하드캡 이내로 제한
            int maxVehicles = request.getNumVehicle() > 0
                    ? Math.min(request.getNumVehicle(), VIEWPORT_HARD_CAP)
                    : VIEWPORT_DEFAULT_MAX_VEHICLES;
            long t0 = System.currentTimeMillis();
            java.util.Set<String> stickyIds = request.getStickyIds() != null
                    ? new java.util.HashSet<>(request.getStickyIds()) : null;
            VehicleDataReader.FilteredVehicleEvents filtered = vehicleDataReader.readVehicleEventsFiltered(
                    scenarioKey, linkIds, from, to, maxVehicles, stickyIds);
            List<VehicleEvent> events = filtered.events();
            Map<String, List<VehicleEvent>> grouped = events.stream()
                    .collect(Collectors.groupingBy(VehicleEvent::getId));

            List<Map<String, Object>> czml = Collections.synchronizedList(new ArrayList<>());
            List<Map<String, Object>> featureList = Collections.synchronizedList(new ArrayList<>());
            List<Map<String, Object>> vehiclePathList = Collections.synchronizedList(new ArrayList<>());
            buildVehiclePackets(scenarioKey, grouped, ctx.scenario(),
                    ctx.baseEpoch(), Instant.ofEpochSecond(ctx.baseEpoch()), ctx.vehicleInfoMap(),
                    ctx.nextsimCodeToVehicleId(), czml, featureList, vehiclePathList);

            // document clock 은 전체 시뮬 시간 범위 (viewport 마다 달라지지 않음 → 재생 clock 안정)
            Instant globalStart = Instant.ofEpochSecond(ctx.baseEpoch() + (long) ctx.simMin());
            Instant globalStop = Instant.ofEpochSecond(ctx.baseEpoch() + (long) Math.ceil(ctx.simMax()));
            Map<String, Object> documentPacket = Map.of(
                    "id", "document",
                    "name", "Vehicle Movement",
                    "version", "1.0",
                    "clock", Map.of(
                            "interval", globalStart + "/" + globalStop,
                            "currentTime", globalStart.toString(),
                            "multiplier", 1,
                            "range", "CLAMPED",
                            "step", "SYSTEM_CLOCK_MULTIPLIER"
                    )
            );
            czml.addFirst(documentPacket);

            boolean truncated = filtered.totalVehicles() > maxVehicles;
            logger.info("[viewport] {} bbox=({},{},{},{}) window={}~{} → 차량 {}/{}대{}, 이벤트 {}건 ({}ms)",
                    scenarioKey, west, south, east, north, from, to,
                    grouped.size(), filtered.totalVehicles(), truncated ? " (상한 초과)" : "",
                    events.size(), System.currentTimeMillis() - t0);

            Map<String, Object> response = new HashMap<>();
            response.put("czml", czml);
            response.put("features", featureList);
            response.put("positions", vehiclePathList);
            response.put("simRange", List.of(ctx.simMin(), ctx.simMax()));
            response.put("window", Map.of("fromTime", from, "toTime", to, "bufferSec", buffer));
            response.put("totalVehicles", filtered.totalVehicles());
            response.put("truncated", truncated);
            return ResponseEntity.ok(response);

        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "bbox 숫자 형식 오류"));
        } catch (java.io.FileNotFoundException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[viewport] {} 요청 실패", scenarioKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "알 수 없는 오류"));
        }
    }

    /**
     * bbox 안에 "지금 이 순간"(fromTime ± {@link #ACTIVE_COUNT_HALF_WINDOW_SEC}초) 존재하는
     * 서로 다른 차량 수만 가볍게 반환 — /viewport의 totalVehicles는 CZML 프리페치를 위해 최대
     * 300초 창의 누적 통행량이라 화면 표시용으로 쓰면 "차량이 안 보이는데 수백 대"로 보이는
     * 오해를 준다(실측 보고). 이벤트/CZML을 만들지 않고 COUNT만 구해 자주 폴링해도 가볍다.
     * body: { bbox: "w,s,e,n", fromTime }
     */
    @PostMapping("/vehicle-route/{scenarioKey}/active-count")
    public ResponseEntity<Map<String, Object>> getActiveVehicleCount(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) {
        try {
            if (request.getBbox() == null || request.getBbox().isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "bbox 파라미터가 필요합니다"));
            }
            String[] p = request.getBbox().split(",");
            if (p.length != 4) {
                return ResponseEntity.badRequest().body(Map.of("error", "bbox 형식: west,south,east,north"));
            }
            double west = Double.parseDouble(p[0].trim());
            double south = Double.parseDouble(p[1].trim());
            double east = Double.parseDouble(p[2].trim());
            double north = Double.parseDouble(p[3].trim());
            double atTime = request.getFromTime() != null ? request.getFromTime() : 0;

            if (!fileStorage.exists(scenarioKey + "/vehicle_sim.db")) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "vehicle_sim.db 없음: " + scenarioKey));
            }

            List<String> linkIds = new ArrayList<>();
            for (var link : networkTileService.queryByBbox(
                    scenarioKey, west, south, east, north, NetworkTileService.Lod.NEAR).getLinks()) {
                if (link.getId() != null) linkIds.add(String.valueOf(link.getId()));
            }

            int count = vehicleDataReader.countActiveVehicles(scenarioKey, linkIds, atTime, ACTIVE_COUNT_HALF_WINDOW_SEC);
            return ResponseEntity.ok(Map.of("count", count));

        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "bbox 숫자 형식 오류"));
        } catch (Exception e) {
            logger.error("[active-count] {} 요청 실패", scenarioKey, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "알 수 없는 오류"));
        }
    }

    @GetMapping("/signal-timeline/{scenarioKey}")
    public ResponseEntity<List<SignalTimelineResponse>> getSignalTimelineByPlan(
            @PathVariable String scenarioKey,
            @RequestParam long baseEpoch,
            @RequestParam String planId,
            @RequestParam int duration) {
        logger.info("[getSignalTimelineByPlan] scenarioKey={}, planId={}, baseEpoch={}, duration={}", scenarioKey, planId, baseEpoch, duration);
        try {
            List<SignalTimelineResponse> result = signalTimelineService.generateSignalTimeline(baseEpoch, planId, scenarioKey, duration);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            logger.error("[getSignalTimelineByPlan] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** VehicleDataReader가 지원하는 테이블별 필수 컬럼 (하나라도 매칭되면 유효한 vehicle_sim.db) */
    private static final Map<String, List<String>> VEHICLE_DB_REQUIRED_COLUMNS = Map.of(
            "VehicleEvent", List.of("veh_id", "timestep", "link_id", "lane_id", "pos_x", "pos_y"),
            "VehicleEventDebugging", List.of("veh_id", "type", "timestep", "link_id", "lane_id", "pos_x", "pos_y", "spd", "acc", "spacing", "mode", "leader_id", "target_lane_id"),
            "vehicle_sim", List.of("id", "timestep", "pos_x", "pos_y", "link_id")
    );

    /** 시뮬레이션 결과 SQLite 파일(vehicle_sim.db) 업로드 — SFTP 저장 후 캐시된 경로 데이터 삭제 */
    @PostMapping("/upload-db/{versionId}")
    public ResponseEntity<Map<String, Object>> uploadVehicleSimDb(
            @PathVariable String versionId,
            @RequestParam("file") MultipartFile file) throws IOException {
        logger.info("[uploadVehicleSimDb] versionId={}, filename={}, size={}bytes", versionId, file.getOriginalFilename(), file.getSize());

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "파일이 비어 있습니다."));
        }

        byte[] header = new byte[16];
        try (InputStream is = file.getInputStream()) {
            int read = is.readNBytes(header, 0, 16);
            if (read < 15 || !"SQLite format 3".equals(new String(header, 0, 15, StandardCharsets.US_ASCII))) {
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(Map.of("error", "유효한 SQLite(.db) 파일이 아닙니다. (SQLite 헤더 불일치)"));
            }
        }

        File tempFile = File.createTempFile("vehicle_sim_upload_", ".db");
        try {
            file.transferTo(tempFile);

            String schemaError = validateVehicleSimDbSchema(tempFile);
            if (schemaError != null) {
                logger.warn("[uploadVehicleSimDb] 스키마 검증 실패 versionId={}: {}", versionId, schemaError);
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(Map.of("error", schemaError));
            }

            try (InputStream is = new FileInputStream(tempFile)) {
                fileStorage.uploadFile(is, versionId, "vehicle_sim.db");
            }
        } finally {
            tempFile.delete();
        }
        logger.info("[uploadVehicleSimDb] {} vehicle_sim.db SFTP 업로드 완료", versionId);

        // 캐시된 차량 경로 데이터 삭제 → 다음 재생 시 새 DB로 재생성
        vehicleRouteService.getByVersionId(versionId).ifPresent(vehicleRouteService::deleteRoute);
        // viewport 스트리밍 컨텍스트/DB 사본 캐시도 무효화 (새 DB 반영)
        viewportCtxCache.remove(versionId);
        vehicleDataReader.invalidateDbCache(versionId);

        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    /**
     * 업로드된 SQLite 파일이 VehicleDataReader가 읽을 수 있는 스키마인지 검사한다.
     * VehicleEvent / VehicleEventDebugging / vehicle_sim 테이블 중 하나가 필요한 컬럼을 모두 갖춰야 한다.
     * @return 문제 없으면 null, 문제가 있으면 사용자에게 보여줄 에러 메시지
     */
    private String validateVehicleSimDbSchema(File dbFile) {
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath())) {
            Set<String> tableNames = new HashSet<>();
            try (ResultSet rs = conn.getMetaData().getTables(null, null, "%", new String[]{"TABLE"})) {
                while (rs.next()) tableNames.add(rs.getString("TABLE_NAME"));
            }

            String matchedKey = null;
            String matchedTable = null;
            for (String candidate : VEHICLE_DB_REQUIRED_COLUMNS.keySet()) {
                String found = tableNames.stream().filter(candidate::equalsIgnoreCase).findFirst().orElse(null);
                if (found != null) {
                    matchedKey = candidate;
                    matchedTable = found;
                    break;
                }
            }

            if (matchedTable == null) {
                return String.format(
                        "차량 시뮬레이션 데이터 테이블(VehicleEvent, VehicleEventDebugging, vehicle_sim)을 찾을 수 없습니다. "
                                + "이 DB에 있는 테이블: %s",
                        tableNames.isEmpty() ? "없음" : String.join(", ", tableNames));
            }

            Set<String> columns = new HashSet<>();
            try (ResultSet rs = conn.getMetaData().getColumns(null, null, matchedTable, "%")) {
                while (rs.next()) columns.add(rs.getString("COLUMN_NAME").toLowerCase());
            }

            List<String> missing = VEHICLE_DB_REQUIRED_COLUMNS.get(matchedKey).stream()
                    .filter(col -> !columns.contains(col.toLowerCase()))
                    .toList();

            if (!missing.isEmpty()) {
                return String.format(
                        "%s 테이블에 필요한 컬럼이 없습니다: %s (현재 컬럼: %s)",
                        matchedTable, String.join(", ", missing), String.join(", ", columns));
            }

            return null;
        } catch (SQLException e) {
            return "SQLite 파일을 읽을 수 없습니다: " + e.getMessage();
        }
    }

    @GetMapping("/vehicle-route/{scenarioKey}/exists")
    public ResponseEntity<Map<String, Object>> checkVehicleRouteExists(@PathVariable String scenarioKey) {
        boolean exists = vehicleRouteService.getByVersionId(scenarioKey).isPresent();
        boolean generating = generatingSet.containsKey(scenarioKey);
        // 시뮬 원본(vehicle_sim.db) 존재 여부 — CZML 캐시가 없어도 원본이 있으면 로드 가능
        // (프론트가 "데이터 있을 때만 POST" 판단에 사용 → 더미 자동 생성 방지)
        boolean simDbExists = exists || fileStorage.exists(scenarioKey + "/vehicle_sim.db");
        return ResponseEntity.ok(Map.of("exists", exists, "generating", generating, "simDbExists", simDbExists));
    }

    @DeleteMapping("/vehicle-route/{scenarioKey}")
    public ResponseEntity<Void> deleteVehicleRoute(@PathVariable String scenarioKey) {
        generatingSet.remove(scenarioKey);
        viewportCtxCache.remove(scenarioKey);
        vehicleDataReader.invalidateDbCache(scenarioKey);
        vehicleRouteService.getByVersionId(scenarioKey).ifPresent(vehicleRouteService::deleteRoute);
        try {
            fileStorage.deleteFile(scenarioKey + "/vehicle_sim.db");
        } catch (Exception e) {
            logger.warn("[vehicle-route] {} vehicle_sim.db 삭제 실패(무시): {}", scenarioKey, e.getMessage());
        }
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/vehicle-route/{scenarioKey}")
    public ResponseEntity<Map<String, Object>> getVehicleRoute(
            @RequestBody VehicleRequest request,
            @PathVariable String scenarioKey) throws IOException {

        // regenerate=true이면 캐시 강제 삭제 후 처음부터 재생성
        if (request.isRegenerate()) {
            logger.info("[vehicle-route] {} 강제 재생성 요청 — CZML 캐시 및 vehicle_sim.db 삭제", scenarioKey);
            vehicleRouteService.getByVersionId(scenarioKey).ifPresent(vehicleRouteService::deleteRoute);
            failedSet.remove(scenarioKey);
            viewportCtxCache.remove(scenarioKey);
            vehicleDataReader.invalidateDbCache(scenarioKey);
            try {
                fileStorage.deleteFile(scenarioKey + "/vehicle_sim.db");
                logger.info("[vehicle-route] {} vehicle_sim.db 삭제 완료", scenarioKey);
            } catch (Exception e) {
                logger.warn("[vehicle-route] {} vehicle_sim.db 삭제 실패(무시): {}", scenarioKey, e.getMessage());
            }
        }

        Optional<VehicleRoute> optional = vehicleRouteService.getByVersionId(scenarioKey);

        if (optional.isEmpty()) {
            // 대용량 DB: 전체 CZML 캐시를 만들지 않는 정책 → 생성 재시작 없이 largeMode 즉시 반환.
            // (없으면 폴링이 매번 '캐시 없음 → 재생성'을 반복하는 무한 루프가 됨)
            if (!generatingSet.containsKey(scenarioKey)) {
                long evCount = vehicleDataReader.countEvents(scenarioKey);
                if (evCount > LARGE_EVENT_THRESHOLD) {
                    logger.info("[vehicle-route] {} 대용량 DB (이벤트 {}건) — largeMode 응답 (viewport 스트리밍 사용)", scenarioKey, evCount);
                    return ResponseEntity.ok(Map.of("status", "ok", "largeMode", true, "events", evCount));
                }
            }

            // 이전 생성 실패 에러가 있으면 반환
            String failMsg = failedSet.remove(scenarioKey);
            if (failMsg != null) {
                logger.warn("[vehicle-route] {} 이전 생성 실패 결과 반환: {}", scenarioKey, failMsg);
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body(Map.of("status", "failed", "message", failMsg));
            }
            // 이미 생성 중이면 202 반환 (현재 단계 포함)
            if (generatingSet.containsKey(scenarioKey)) {
                String stage = stageMap.getOrDefault(scenarioKey, "처리 중...");
                long elapsedSec = startTimeMap.containsKey(scenarioKey)
                        ? (System.currentTimeMillis() - startTimeMap.get(scenarioKey)) / 1000
                        : 0;
                logger.info("[vehicle-route] {} 생성 중 [{}] {}초 경과", scenarioKey, stage, elapsedSec);
                return ResponseEntity.status(HttpStatus.ACCEPTED)
                        .body(Map.of("status", "generating",
                                "stage", stage,
                                "elapsed", elapsedSec,
                                "message", stage));
            }
            // 명시적 생성 요청이 아니고 시뮬 원본(vehicle_sim.db)도 없으면 생성 스레드를 띄우지 않는다
            // (로드 경로 POST가 더미 생성을 유발하지 않도록 — 생성은 프론트 생성 버튼 전용)
            if (!request.isGenerateDummy() && !fileStorage.exists(scenarioKey + "/vehicle_sim.db")) {
                logger.info("[vehicle-route] {} 시뮬 원본 없음 + 비명시 요청 — 404 반환 (더미 생성 안 함)", scenarioKey);
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("status", "no-data",
                                "message", "시뮬레이션 데이터가 없습니다. 시뮬레이션 생성 버튼으로 생성하세요."));
            }
            // 비동기 생성 시작 후 202 반환
            generatingSet.put(scenarioKey, true);
            startTimeMap.put(scenarioKey, System.currentTimeMillis());
            stageMap.put(scenarioKey, "초기화 중...");
            logger.info("[vehicle-route] {} 비동기 생성 시작", scenarioKey);
            final VehicleRequest req = request;
            new Thread(() -> {
                try {
                    ResponseEntity<Map<String, Object>> result = generateVehicleRoute(req, scenarioKey);
                    if (!result.getStatusCode().is2xxSuccessful()) {
                        // 반환된 에러 ResponseEntity → 예외로 변환하여 failedSet에 등록
                        Object body = result.getBody();
                        String errMsg = "알 수 없는 오류";
                        if (body instanceof Map<?, ?> m) {
                            Object e = m.get("error");
                            if (e != null) errMsg = e.toString();
                        }
                        throw new RuntimeException(errMsg);
                    }
                    logger.info("[vehicle-route] {} 생성 완료", scenarioKey);
                } catch (Throwable e) {
                    // Exception 만 잡으면 OutOfMemoryError 가 failedSet 에 등록되지 않아
                    // 프론트 폴링이 생성을 무한 재시작 → OOM 반복. Throwable 로 잡아 실패 확정.
                    logger.error("[vehicle-route] {} 생성 실패: {}", scenarioKey, e.getMessage());
                    failedSet.put(scenarioKey, e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                } finally {
                    generatingSet.remove(scenarioKey);
                    startTimeMap.remove(scenarioKey);
                    stageMap.remove(scenarioKey);
                }
            }, "vehicle-gen-" + scenarioKey).start();

            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating",
                            "stage", "초기화 중...",
                            "elapsed", 0,
                            "message", "차량 경로 데이터 생성을 시작했습니다."));
        }

        VehicleRoute route = optional.get();

        // czml이 null이면 스테일 레코드 — 삭제 후 재생성
        if (route.getCzml() == null) {
            logger.warn("[vehicle-route] {} DB 레코드는 있으나 czml null — 삭제 후 재생성", scenarioKey);
            vehicleRouteService.deleteRoute(route);
            // 재귀 호출 없이 즉시 비동기 생성 시작
            if (!generatingSet.containsKey(scenarioKey)) {
                generatingSet.put(scenarioKey, true);
                startTimeMap.put(scenarioKey, System.currentTimeMillis());
                stageMap.put(scenarioKey, "초기화 중...");
                final VehicleRequest req = request;
                new Thread(() -> {
                    try {
                        ResponseEntity<Map<String, Object>> result = generateVehicleRoute(req, scenarioKey);
                        if (!result.getStatusCode().is2xxSuccessful()) {
                            Object body = result.getBody();
                            String errMsg = "알 수 없는 오류";
                            if (body instanceof Map<?, ?> m) {
                                Object e = m.get("error");
                                if (e != null) errMsg = e.toString();
                            }
                            throw new RuntimeException(errMsg);
                        }
                        logger.info("[vehicle-route] {} 재생성 완료", scenarioKey);
                    } catch (Exception e) {
                        logger.error("[vehicle-route] {} 재생성 실패: {}", scenarioKey, e.getMessage());
                        failedSet.put(scenarioKey, e.getMessage() != null ? e.getMessage() : "알 수 없는 오류");
                    } finally {
                        generatingSet.remove(scenarioKey);
                        startTimeMap.remove(scenarioKey);
                        stageMap.remove(scenarioKey);
                    }
                }, "vehicle-gen-" + scenarioKey).start();
            }
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating",
                            "stage", "초기화 중...",
                            "elapsed", 0,
                            "message", "경로 데이터 재생성 중입니다."));
        }

        ObjectMapper mapper = new ObjectMapper();

        String dataPath = route.getDataPath() != null ? route.getDataPath() : scenarioKey;
        List<SignalTimelineResponse> signalTimeline = signalTimelineService.generateSignalTimeline(route.getStartTime(), "0", dataPath, 7200);

        try {
            Map<String, Object> response = new HashMap<>();
            response.put("czml", mapper.readValue(route.getCzml(), Object.class));
            response.put("features", route.getFeatures() != null ? mapper.readValue(route.getFeatures(), Object.class) : List.of());
            response.put("positions", route.getPositions() != null ? mapper.readValue(route.getPositions(), Object.class) : List.of());
            response.put("signalTimeline", signalTimeline);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.warn("[vehicle-route] {} JSON 파싱 실패 — 삭제 후 재생성: {}", scenarioKey, e.getMessage());
            vehicleRouteService.deleteRoute(route);
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("status", "generating", "message", "경로 데이터가 손상되어 재생성합니다."));
        }
    }

    /**
     * vehicle_type 테이블(nextsim_type_code 컬럼, "교통수단 유형" 편집 화면에서 관리)에서
     * "NextSim 코드 → 우리 시각화 차종(vehicleId)" 매핑을 빌드한다. 한 차종에 여러 코드를
     * 쉼표로 등록할 수 있다(예: CAR 행에 "NV,AV"). 요청마다(또는 viewport 컨텍스트 수명 동안)
     * 한 번만 호출해서 재사용할 것 — vehicle 단위로 매번 DB 조회하지 않는다.
     *
     * <p>예전엔 이 매핑이 Java 코드에 하드코딩돼 있어("교통수단 유형" 화면에서 차종을 새로
     * 추가/이름 변경해도 반영 안 됨), 사용자가 직접 관리할 수 있도록 DB 기반으로 전환했다.
     */
    private Map<String, String> loadNextsimCodeToVehicleIdMap() {
        Map<String, String> map = new HashMap<>();
        for (var vt : vehicleTypeRepository.findAll()) {
            if (vt.getVehicleId() == null) continue;
            String vehicleId = vt.getVehicleId().toUpperCase();
            // 코드 매핑이 없어도 vehicleId 자기 자신은 항상 통과시킨다(예: dbType이 이미
            // "CAR"/"BUS" 같은 우리 분류명 그대로 온 경우).
            map.put(vehicleId, vehicleId);
            if (vt.getNextsimTypeCode() == null || vt.getNextsimTypeCode().isBlank()) continue;
            for (String code : vt.getNextsimTypeCode().split(",")) {
                String trimmed = code.trim();
                if (!trimmed.isEmpty()) map.put(trimmed.toUpperCase(), vehicleId);
            }
        }
        return map;
    }

    /**
     * vehicle ID 또는 DB의 type 값을 기반으로 차량 유형을 결정합니다.
     * DB에 type 컬럼이 없거나 null이거나 인식 불가한 코드인 경우 vehicle ID 숫자로 분포 배정합니다.
     * 배정 비율: CAR 70%, TAXI 15%, BUS 10%, TRUCK 4%, MOTO 1%
     */
    private String resolveVehicleType(String vehicleId, String dbType, Map<String, String> nextsimCodeToVehicleId) {
        if (dbType != null && !dbType.isBlank()) {
            String mapped = nextsimCodeToVehicleId.get(dbType.toUpperCase());
            if (mapped != null) return mapped;
            // 매핑도 없고 우리 분류명도 아닌 낯선 코드 — 그대로 내보내면 어떤 3D 모델과도
            // 매칭 안 돼 항상 기본 GLB로만 렌더되므로, 아래 ID 해시 폴백으로 계속 진행한다.
        }
        // DB에 type 없을 때 vehicle ID 기반으로 배정
        try {
            int id = Integer.parseInt(vehicleId.replaceAll("[^0-9]", ""));
            int mod = id % 100;
            if (mod < 70)  return "CAR";
            if (mod < 85)  return "TAXI";
            if (mod < 95)  return "BUS";
            if (mod < 99)  return "TRUCK";
            return "MOTO";
        } catch (NumberFormatException e) {
            return "CAR";
        }
    }

    /**
     * signal.xml + NetworkXml을 파싱해 DummyVehicleGenerator.SignalContext를 생성한다.
     * signal.xml이 없거나 파싱 실패 시 빈 컨텍스트를 반환 (신호 무시).
     */
    private DummyVehicleGenerator.SignalContext buildSignalContext(NetworkXml networkXml, String signalXmlUrl) {
        // ── linkId → toNodeId ──────────────────────────────────────────
        Map<String, String> linkToNode = new HashMap<>();
        if (networkXml.getLinks() != null) {
            for (LinkXml link : networkXml.getLinks()) {
                if (link.getId() != null && link.getToNode() != null) {
                    linkToNode.put(String.valueOf(link.getId()), String.valueOf(link.getToNode()));
                }
            }
        }

        // ── "nodeId_connId" → {fromLinkId, toLinkId} ───────────────────
        // network.xml의 connection id는 노드별 로컬 ID(0,1,2,...)이므로
        // connId 단독을 전역 키로 쓰면 서로 다른 노드의 connection이 충돌한다.
        Map<String, String[]> connIdToMeta = new HashMap<>();
        if (networkXml.getNodes() != null) {
            for (NodeXml node : networkXml.getNodes()) {
                if (node.getConnections() == null) continue;
                String nodeId = String.valueOf(node.getId());
                for (ConnectionXml conn : node.getConnections()) {
                    if (conn.getId() == null || conn.getFromLink() == null || conn.getToLink() == null) continue;
                    connIdToMeta.put(nodeId + "_" + conn.getId(), new String[]{
                        String.valueOf(conn.getFromLink()),
                        String.valueOf(conn.getToLink())
                    });
                }
            }
        }

        // ── signal.xml 파싱 ───────────────────────────────────────────
        Map<String, DummyVehicleGenerator.NodeSignalInfo> nodeSignals = new HashMap<>();
        Map<String, String> connKeyToTurn = new HashMap<>();

        try (InputStream signalIs = RemoteXmlFetch.openStream(signalXmlUrl)) {
            Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(signalIs);
            NodeList signalNodes = doc.getElementsByTagName("node");

            for (int i = 0; i < signalNodes.getLength(); i++) {
                Element nodeEl = (Element) signalNodes.item(i);
                String nodeId = nodeEl.getAttribute("id");

                // turn 파싱: connId → turnId, RTOR 여부
                Map<String, String> connIdStrToTurnId = new HashMap<>();
                Set<String> rtorTurns = new HashSet<>();

                NodeList turns = nodeEl.getElementsByTagName("turn");
                for (int t = 0; t < turns.getLength(); t++) {
                    Element turnEl = (Element) turns.item(t);
                    String turnId = turnEl.getAttribute("id");
                    String type   = turnEl.getAttribute("type");

                    if ("RTOR".equalsIgnoreCase(type)) rtorTurns.add(turnId);

                    // connList 또는 conn_list 속성
                    String connListStr = turnEl.getAttribute("connList");
                    if (connListStr.isEmpty()) connListStr = turnEl.getAttribute("conn_list");

                    for (String cid : connListStr.trim().split("\\s+")) {
                        if (!cid.isEmpty()) connIdStrToTurnId.put(cid, turnId);
                    }
                }

                // connKey 매핑 구성
                for (Map.Entry<String, String> entry : connIdStrToTurnId.entrySet()) {
                    String[] meta = connIdToMeta.get(nodeId + "_" + entry.getKey());
                    if (meta == null) continue;
                    String key    = nodeId + "_" + meta[0] + "_" + meta[1];
                    String turnId = entry.getValue();
                    // RTOR → 빈 문자열(항상 통과)
                    connKeyToTurn.put(key, rtorTurns.contains(turnId) ? "" : turnId);
                }

                // plan 파싱 (plan id="0" 우선, 없으면 첫 번째)
                Element planListEl = firstElement(nodeEl, "planList", "plan_list");
                if (planListEl == null) continue;

                NodeList plans = planListEl.getElementsByTagName("plan");
                Element selectedPlan = null;
                for (int p = 0; p < plans.getLength(); p++) {
                    Element plan = (Element) plans.item(p);
                    if ("0".equals(plan.getAttribute("id"))) { selectedPlan = plan; break; }
                }
                if (selectedPlan == null && plans.getLength() > 0) selectedPlan = (Element) plans.item(0);
                if (selectedPlan == null) continue;

                int cycle  = Integer.parseInt(selectedPlan.getAttribute("cycle"));
                int offset = Integer.parseInt(selectedPlan.getAttribute("offset"));

                NodeList phases = selectedPlan.getElementsByTagName("phase");
                List<DummyVehicleGenerator.PhaseInfo> phaseList = new ArrayList<>();
                for (int ph = 0; ph < phases.getLength(); ph++) {
                    Element phaseEl  = (Element) phases.item(ph);
                    int duration = Integer.parseInt(phaseEl.getAttribute("duration"));
                    String tList = phaseEl.getAttribute("turnList");
                    if (tList.isEmpty()) tList = phaseEl.getAttribute("turn_list");

                    Set<String> activeTurns = new HashSet<>(Arrays.asList(tList.trim().split("\\s+")));
                    activeTurns.remove("");
                    phaseList.add(new DummyVehicleGenerator.PhaseInfo(duration, activeTurns));
                }

                nodeSignals.put(nodeId, new DummyVehicleGenerator.NodeSignalInfo(cycle, offset, phaseList));
            }

            logger.info("[buildSignalContext] signal.xml 파싱 완료: 신호 노드 {}개, connKey 매핑 {}개",
                    nodeSignals.size(), connKeyToTurn.size());

        } catch (java.io.FileNotFoundException e) {
            logger.warn("[buildSignalContext] signal.xml 없음 — 네트워크 구조 기반 더미 신호 생성: {}", signalXmlUrl);
            return dummySignalGenerator.generate(networkXml, linkToNode);
        } catch (Exception e) {
            logger.warn("[buildSignalContext] signal.xml 파싱 실패 — 더미 신호로 대체: {}", e.getMessage());
            return dummySignalGenerator.generate(networkXml, linkToNode);
        }

        return new DummyVehicleGenerator.SignalContext(nodeSignals, linkToNode, connKeyToTurn);
    }

    /** tagNames 중 첫 번째로 존재하는 Element를 반환한다 (대소문자/언더스코어 변형 처리). */
    private Element firstElement(Element parent, String... tagNames) {
        for (String tag : tagNames) {
            NodeList nl = parent.getElementsByTagName(tag);
            if (nl.getLength() > 0) return (Element) nl.item(0);
        }
        return null;
    }
}