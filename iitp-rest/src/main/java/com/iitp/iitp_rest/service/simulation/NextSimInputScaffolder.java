package com.iitp.iitp_rest.service.simulation;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.service.vehicle.DummySignalGenerator;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerVersionService;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 네트워크 임포트 직후 NextSim 실행에 필요한 입력 파일을 정비한다.
 *
 * <p>목표: KTDB 가져오기만으로 "NextSim 실행" 버튼이 바로 동작하는 상태 만들기.
 * 생성 파일은 모두 해당 관리 UI(OD 매트릭스/신호/시나리오 메뉴)에서 수정 가능한 시작점이다.
 *
 * <p><b>재임포트 = 노드/링크 id 전면 교체</b>이므로 "없을 때만 생성"으로는 부족하다.
 * 네트워크 id 를 참조하는 파일은 기존 파일이 있어도 새 네트워크와 대조해 낡았으면 재생성한다:
 * <ul>
 *   <li>odmatrix.xml — source=out포트 터미널 id, sink=in포트 터미널 id. 방향이 안 맞거나
 *       하나라도 새 집합에 없으면 재생성</li>
 *   <li>signal.xml — node id 참조. 하나라도 새 노드 집합에 없으면 재생성 — 파싱된 네트워크가
 *       있으면 {@link DummySignalGenerator}로 교차로 구조 기반 더미 신호를 생성하고, 없으면(대형
 *       bbox 스트리밍 임포트) 빈 템플릿으로 폴백</li>
 *   <li>signalTOD.xml — signal 의 플랜을 참조하므로 signal 재생성 시 함께 재생성</li>
 *   <li>scenario.xml — 내부 id(odMatrixID/todID)만 참조 = 네트워크 무관 → 없을 때만 생성</li>
 * </ul>
 * 재생성 시 대응하는 DB 레이어(xml_layer_versions: od_matrix/signal_tod)도 삭제한다 —
 * 조회가 DB 우선이라 파일만 갈면 낡은 DB 편집본이 새 파일을 가린다(네트워크 임포트의
 * deleteVersion("network") 와 동일한 이유).
 *
 * <p>저장 위치 규약 — 전부 <b>versionId 폴더</b>(버전별 격리). 관리 서비스(OdMatrixService/
 * SimulationRunService/SignalTodService/SignalController)와 러너(NextSimRunner.candidateDirs)
 * 모두 versionId 우선 → 부모 scenario key 폴백으로 읽고 versionId 에 저장하므로 일치한다.
 * 검증 대상은 그 폴백 규약으로 실제 읽히게 될 파일이다. 부모 폴더 파일은 수정하지 않고
 * (다른 버전이 공유), 낡았으면 versionId 폴더에 새 파일을 만들어 가린다. 버전 폴더의
 * 낡은 파일은 {@code .stale.bak} 으로 백업 후 교체한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NextSimInputScaffolder {

    private final FileStorageService fileStorage;
    private final ScenarioVersionRepository scenarioVersionRepository;
    private final XmlLayerVersionService xmlLayerVersionService;
    private final DummySignalGenerator dummySignalGenerator;

    /** 러너 폴백과 동일한 기본 시나리오 (06시 시작 60분, OD 0번, TOD 0번) */
    private static final String SCENARIO_TEMPLATE = xml(
            "<Scenarios>\n" +
            "\t<Scenario id=\"0\" startTime=\"06:00:00\" duration=\"60\" BGTduration=\"0\" odMatrixID=\"0\" todID=\"0\" signalControl=\"False\"/>\n" +
            "</Scenarios>");

    private static final String SIGNAL_TEMPLATE     = xml("<Signal id=\"0\">\n</Signal>");
    private static final String SIGNAL_TOD_TEMPLATE = xml("<TOD id=\"0\">\n</TOD>");

    private static final Pattern SIGNAL_NODE_REF = Pattern.compile("<node\\s+id=\"([^\"]+)\"");

    /**
     * 임포트 직후 입력 파일 정비 — 없으면 생성, 새 네트워크와 안 맞으면 재생성.
     * 비동기 호출 전제: 어떤 실패도 같은 async 블록의 후속 작업(타일 빌드)을 막으면 안 된다.
     *
     * @param allNodeIds        새 네트워크의 전체 노드 id (signal.xml 참조 검증)
     * @param sourceTerminalIds out 포트만 있는 터미널 — 나갈 링크만 있어 source(출발지)로만 유효
     * @param sinkTerminalIds   in 포트만 있는 터미널 — 들어올 링크만 있어 sink(도착지)로만 유효
     *                          (실측: 배포판 부천 odmatrix.xml — source 전부 out포트, sink 전부
     *                          in포트로 완전히 분리돼 있음. 반대로 섞으면 해당 방향 링크가 없는
     *                          노드에서 경로를 요구하는 셈이라 무효)
     */
    public void scaffoldForImport(String versionId, Set<String> allNodeIds,
                                   List<Long> sourceTerminalIds, List<Long> sinkTerminalIds) {
        scaffoldForImport(versionId, allNodeIds, sourceTerminalIds, sinkTerminalIds, null, null);
    }

    /**
     * @param terminalLocalCoords 터미널 id → 로컬 평면좌표(x,y, 단위 임의 — 상대 거리 계산에만
     *                            사용). 있으면 OD 샘플 수요를 거리 기반(근접 sink 우선 + 거리
     *                            감쇠 flow)으로 생성해 임의 원거리 쌍보다 훨씬 그럴듯한 통행
     *                            패턴을 만든다. null 이면 기존 결정적 회전 방식으로 폴백.
     */
    public void scaffoldForImport(String versionId, Set<String> allNodeIds,
                                   List<Long> sourceTerminalIds, List<Long> sinkTerminalIds,
                                   java.util.Map<Long, double[]> terminalLocalCoords) {
        scaffoldForImport(versionId, allNodeIds, sourceTerminalIds, sinkTerminalIds, terminalLocalCoords, null);
    }

    /**
     * @param networkForSignal 신호 자동생성(더미 신호 생성기, {@link DummySignalGenerator})에 쓸
     *                          파싱된 네트워크. null 이면 signal.xml 은 기존처럼 빈 템플릿으로
     *                          생성된다(대형 bbox 스트리밍 임포트 경로는 아직 JAXB NetworkXml 을
     *                          구성하지 않으므로 null 을 넘김 — 노드 수가 커 더미 신호 계산
     *                          비용도 함께 커지는 경로라 우선 범위에서 제외).
     */
    public void scaffoldForImport(String versionId, Set<String> allNodeIds,
                                   List<Long> sourceTerminalIds, List<Long> sinkTerminalIds,
                                   java.util.Map<Long, double[]> terminalLocalCoords,
                                   NetworkXml networkForSignal) {
        if (versionId == null || versionId.isBlank()) return;
        List<String> lookupDirs;
        try {
            String scenarioKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                    .map(v -> v.getScenario().getKey())
                    .orElse(versionId);
            lookupDirs = scenarioKey.equals(versionId)
                    ? List.of(versionId) : List.of(versionId, scenarioKey);
        } catch (Exception e) {
            log.warn("[NextSimScaffold] scenario key 조회 실패 — versionId 폴더만 확인: {}", e.getMessage());
            lookupDirs = List.of(versionId);
        }

        Set<String> sourceIdSet = toStringSet(sourceTerminalIds);
        Set<String> sinkIdSet = toStringSet(sinkTerminalIds);

        try {
            ensureValidOrRegenerate(lookupDirs, versionId, "odmatrix.xml",
                    content -> odMatrixValid(content, sourceIdSet, sinkIdSet),
                    buildSampleOdMatrix(sourceTerminalIds, sinkTerminalIds, terminalLocalCoords), "od_matrix");

            // signalTOD 검증에 signal.xml 의 "실제 플랜 보유 노드" 집합이 필요 — 재생성 전에
            // 미리 읽어둔다(재생성되면 아래에서 무조건 signalTOD 도 같이 재생성하므로 무관해짐).
            String signalContentBefore = readFirstExisting(lookupDirs, "signal.xml");
            String signalFreshContent = networkForSignal != null
                    ? dummySignalGenerator.generateSignalXml(networkForSignal)
                    : SIGNAL_TEMPLATE;
            boolean signalRegenerated = ensureValidOrRegenerate(lookupDirs, versionId, "signal.xml",
                    content -> signalValid(content, allNodeIds),
                    signalFreshContent, null);

            // signalTOD 는 signal 플랜을 참조 — signal 이 재생성됐으면 기존 TOD 도 무조건 낡은 것.
            // 그렇지 않더라도(signal.xml 자체는 유효해도) **TOD 가 signal 의 플랜 보유 노드를
            // 전부 커버하는지**는 별도로 검증해야 한다 — 실측(scenario1_2): signal.xml 은 여러
            // 노드에 실제 turnList/planList 를 갖고 있는데 signalTOD.xml 은 노드 0개(완전 공백)
            // 였고, 이 불일치가 nextsim 을 std::out_of_range 로 크래시시켰다(route-generator 는
            // signal.xml 을 안 읽어 무관 — nextsim 만의 별도 크래시 원인이었음, "존재하기만
            // 하면 통과"였던 기존 createIfAbsent 로는 절대 못 잡음).
            if (signalRegenerated) {
                Set<String> freshPlanNodeIds = extractSignalPlanNodeIds(signalFreshContent);
                String freshTod = buildDefaultSignalTod(signalFreshContent, freshPlanNodeIds);
                regenerate(versionId, "signalTOD.xml", freshTod, "signal_tod",
                        "signal.xml 재생성에 연동");
            } else {
                // signal.xml 자체는 유효(노드 참조 OK)해도 TOD 커버리지가 빠지면, TOD 만 빈
                // 템플릿으로 갈면 signal.xml 의 실제 플랜과 여전히 안 맞아 크래시가 재발한다
                // (실측). signal.xml 은 "더미 신호 생성" 등으로 만들어진 실데이터일 수 있어
                // 함부로 비우지 않고, **그 데이터에 맞는 기본 TOD 를 생성**해 세트를 맞춘다
                // (각 플랜 보유 노드의 최소 plan id 로 하루 종일 커버 — 신호 UI 에서 이후
                // 세밀 조정 가능한 시작점).
                Set<String> signalPlanNodeIds = extractSignalPlanNodeIds(signalContentBefore);
                ensureValidOrRegenerate(lookupDirs, versionId, "signalTOD.xml",
                        content -> signalTodValid(content, signalPlanNodeIds),
                        buildDefaultSignalTod(signalContentBefore, signalPlanNodeIds), "signal_tod");
            }

            // scenario.xml 은 네트워크 id 무관 — 있으면 그대로 유효
            createIfAbsent(lookupDirs, versionId, "scenario.xml", SCENARIO_TEMPLATE);
        } catch (Exception e) {
            log.warn("[NextSimScaffold] 입력 정비 실패 (무시): {}", e.getMessage());
        }
    }

    // ── 파일 단위 처리 ───────────────────────────────────────────────────────

    /**
     * 폴백 규약(versionId → 부모)으로 실제 읽히게 될 파일을 찾아 검증.
     * 없거나 낡았으면 versionId 폴더에 새로 생성. 재생성 여부를 반환.
     */
    private boolean ensureValidOrRegenerate(List<String> lookupDirs, String versionId, String fileName,
                                            java.util.function.Predicate<String> validator,
                                            String freshContent, String dbLayerKey) {
        try {
            for (String dir : lookupDirs) {
                String key = dir + "/" + fileName;
                if (!fileStorage.exists(key)) continue;
                String content = new String(fileStorage.readFile(key), StandardCharsets.UTF_8);
                if (validator.test(content)) {
                    log.info("[NextSimScaffold] {}/{} 유효 — 유지", dir, fileName);
                    return false;
                }
                // 낡음 — 버전 폴더 파일이면 백업 (부모 폴더 파일은 건드리지 않고 가리기만)
                if (dir.equals(versionId)) {
                    fileStorage.uploadFile(new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)),
                            versionId, fileName + ".stale.bak");
                }
                log.info("[NextSimScaffold] {}/{} 가 새 네트워크와 불일치(재임포트로 id 변경) — 재생성", dir, fileName);
                writeFresh(versionId, fileName, freshContent, dbLayerKey);
                return true;
            }
            // 어디에도 없음 — 신규 생성 (DB 레이어에 파일보다 오래된 편집본이 있을 수 있어 함께 삭제)
            writeFresh(versionId, fileName, freshContent, dbLayerKey);
            return true;
        } catch (Exception e) {
            log.warn("[NextSimScaffold] {}/{} 정비 실패 (무시): {}", versionId, fileName, e.getMessage());
            return false;
        }
    }

    private void regenerate(String versionId, String fileName, String content, String dbLayerKey, String reason) {
        try {
            String key = versionId + "/" + fileName;
            if (fileStorage.exists(key)) {
                byte[] old = fileStorage.readFile(key);
                fileStorage.uploadFile(new ByteArrayInputStream(old), versionId, fileName + ".stale.bak");
            }
            log.info("[NextSimScaffold] {}/{} 재생성 ({})", versionId, fileName, reason);
            writeFresh(versionId, fileName, content, dbLayerKey);
        } catch (Exception e) {
            log.warn("[NextSimScaffold] {}/{} 재생성 실패 (무시): {}", versionId, fileName, e.getMessage());
        }
    }

    private void writeFresh(String versionId, String fileName, String content, String dbLayerKey) throws Exception {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        fileStorage.uploadFile(new ByteArrayInputStream(bytes), versionId, fileName);
        log.info("[NextSimScaffold] {}/{} 생성 ({} bytes)", versionId, fileName, bytes.length);
        if (dbLayerKey != null) {
            try {
                xmlLayerVersionService.deleteVersion(dbLayerKey, versionId);
            } catch (Exception e) {
                log.warn("[NextSimScaffold] DB 레이어 {} 삭제 실패 (무시): {}", dbLayerKey, e.getMessage());
            }
        }
    }

    /** 폴백 규약(versionId → 부모)으로 실제 읽히게 될 파일의 현재 내용 (없으면 null) */
    private String readFirstExisting(List<String> lookupDirs, String fileName) {
        for (String dir : lookupDirs) {
            String key = dir + "/" + fileName;
            if (!fileStorage.exists(key)) continue;
            try {
                return new String(fileStorage.readFile(key), StandardCharsets.UTF_8);
            } catch (Exception e) {
                log.warn("[NextSimScaffold] {} 읽기 실패 (무시): {}", key, e.getMessage());
                return null;
            }
        }
        return null;
    }

    private void createIfAbsent(List<String> lookupDirs, String targetDir, String fileName, String content) {
        try {
            for (String dir : lookupDirs) {
                if (fileStorage.exists(dir + "/" + fileName)) return;
            }
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            fileStorage.uploadFile(new ByteArrayInputStream(bytes), targetDir, fileName);
            log.info("[NextSimScaffold] {}/{} 기본본 생성 ({} bytes)", targetDir, fileName, bytes.length);
        } catch (Exception e) {
            log.warn("[NextSimScaffold] {}/{} 생성 실패 (무시): {}", targetDir, fileName, e.getMessage());
        }
    }

    // ── 참조 유효성 검증 ─────────────────────────────────────────────────────

    private static final Pattern OD_SOURCE_REF = Pattern.compile("\\bsource=\"([^\"]+)\"");
    private static final Pattern OD_SINK_REF   = Pattern.compile("\\bsink=\"([^\"]+)\"");

    private static Set<String> toStringSet(List<Long> ids) {
        return ids == null ? Set.of()
                : ids.stream().map(String::valueOf).collect(java.util.stream.Collectors.toSet());
    }

    /** OD: 수요가 1건 이상 있고, source 는 전부 source-후보(out포트) 집합, sink 는 전부
     *  sink-후보(in포트) 집합에 존재해야 유효 — 방향이 뒤집혀도(재임포트로 뒤바뀌는 경우 포함) 낡음 처리 */
    public static boolean odMatrixValid(String content, Set<String> sourceIdSet, Set<String> sinkIdSet) {
        boolean any = false;
        Matcher sm = OD_SOURCE_REF.matcher(content);
        while (sm.find()) {
            any = true;
            if (!sourceIdSet.contains(sm.group(1))) return false;
        }
        Matcher km = OD_SINK_REF.matcher(content);
        while (km.find()) {
            if (!sinkIdSet.contains(km.group(1))) return false;
        }
        return any;
    }

    /** 신호: 참조 노드가 없으면(빈 템플릿) 유효, 있으면 전부 새 노드 집합에 존재해야 유효 */
    public static boolean signalValid(String content, Set<String> allNodeIds) {
        if (allNodeIds == null || allNodeIds.isEmpty()) return true; // 대조 불가 — 보수적으로 유지
        Matcher m = SIGNAL_NODE_REF.matcher(content);
        while (m.find()) {
            if (!allNodeIds.contains(m.group(1))) return false;
        }
        return true;
    }

    private static final Pattern SIGNAL_NODE_BLOCK = Pattern.compile("<node id=\"([^\"]+)\">(.*?)</node>", Pattern.DOTALL);

    /** signal.xml 에서 실제 플랜(&lt;plan&gt; 정의)을 가진 노드 id — signalTOD 커버리지 검증 대상 */
    public static Set<String> extractSignalPlanNodeIds(String signalContent) {
        if (signalContent == null || signalContent.isBlank()) return Set.of();
        Set<String> ids = new java.util.LinkedHashSet<>();
        Matcher m = SIGNAL_NODE_BLOCK.matcher(signalContent);
        while (m.find()) {
            if (m.group(2).contains("<plan ")) ids.add(m.group(1));
        }
        return ids;
    }

    /**
     * signalTOD: signal.xml 에 실제 플랜을 가진 노드는 전부 TOD 스케줄(&lt;node&gt; 항목)이
     * 있어야 유효 — 실측: 플랜은 있는데 TOD 항목이 하나도 없으면(부분적으로만 있어도) nextsim 이
     * "지금 어느 플랜을 써야 하는지" 조회 실패로 std::out_of_range 크래시(scenario1_2 재현).
     * signal.xml 자체가 빈 템플릿(플랜 보유 노드 없음)이면 TOD 도 비어야 정상이므로 항상 유효.
     */
    public static boolean signalTodValid(String todContent, Set<String> signalPlanNodeIds) {
        if (signalPlanNodeIds.isEmpty()) return true;
        if (todContent == null) return false;
        Set<String> todNodeIds = new java.util.HashSet<>();
        Matcher m = SIGNAL_NODE_REF.matcher(todContent);
        while (m.find()) todNodeIds.add(m.group(1));
        return todNodeIds.containsAll(signalPlanNodeIds);
    }

    private static final Pattern PLAN_ID = Pattern.compile("<plan id=\"(\\d+)\"");

    /**
     * signal.xml 의 플랜 보유 노드마다 **그 노드의 최소 plan id** 로 하루 종일(00:00~24:00)
     * 커버하는 기본 TOD 를 생성 — signal.xml(더미 신호 생성 등으로 만들어진 실데이터일 수 있음)
     * 을 비우지 않고 세트만 맞춘다. 신호 UI 에서 이후 시간대별로 세밀 조정 가능한 시작점.
     */
    public static String buildDefaultSignalTod(String signalContent, Set<String> signalPlanNodeIds) {
        StringBuilder body = new StringBuilder();
        if (signalContent != null && !signalPlanNodeIds.isEmpty()) {
            Matcher nodeM = SIGNAL_NODE_BLOCK.matcher(signalContent);
            while (nodeM.find()) {
                String nodeId = nodeM.group(1);
                if (!signalPlanNodeIds.contains(nodeId)) continue;
                Matcher planM = PLAN_ID.matcher(nodeM.group(2));
                int minPlan = Integer.MAX_VALUE;
                while (planM.find()) minPlan = Math.min(minPlan, Integer.parseInt(planM.group(1)));
                if (minPlan == Integer.MAX_VALUE) continue;
                body.append("  <node id=\"").append(nodeId).append("\">\n")
                    .append("    <plan id=\"").append(minPlan)
                    .append("\" startTime=\"00:00:00\" endTime=\"24:00:00\"/>\n")
                    .append("  </node>\n");
            }
        }
        return xml("<TOD id=\"0\">\n" + body + "</TOD>");
    }

    /** 사용할 최대 source 터미널 수 (부천 실측: 148 터미널 중 74 source 사용 — 사실상 전량) */
    private static final int MAX_OD_SOURCES = 200;
    /** source 당 연결할 sink 수 (부천 실측: 2021수요/74source ≈ 27 평균) */
    private static final int SINKS_PER_SOURCE = 15;
    /** 거리 감쇠 flow 범위(대/h) — 부천 실측 flow 범위(1~154)와 같은 자릿수 */
    private static final int MIN_FLOW = 5;
    private static final int MAX_FLOW = 60;
    /** 거리 감쇠 기준 거리(m) — 이보다 가까우면 MAX_FLOW 근접, 멀수록 MIN_FLOW 로 수렴 */
    private static final double REF_DIST_M = 300.0;

    public static String buildSampleOdMatrix(List<Long> sourceTerminalIds, List<Long> sinkTerminalIds) {
        return buildSampleOdMatrix(sourceTerminalIds, sinkTerminalIds, null);
    }

    /**
     * 샘플 OD 매트릭스 — 부천 규모(터미널 수백 개, 수천 쌍)를 목표로 source 후보(out포트
     * 터미널)를 대상으로 sink 후보(in포트 터미널) {@link #SINKS_PER_SOURCE}개와 연결한다.
     *
     * <p><b>거리 인지 생성</b>(좌표 있을 때): 각 source 마다 <b>가장 가까운</b> sink 들을
     * 우선 선택하고, flow 는 거리에 반비례(가까울수록 큼, {@link #REF_DIST_M} 기준 감쇠) —
     * 실제 통행은 근거리 편중이 강하므로(중력모형과 동일 원리), 조금만 손보면 바로 쓸 수
     * 있는 그럴듯한 통행 패턴이 나온다. 좌표가 없는 source/sink 쌍은 기존 결정적 회전 방식
     * (거리 무관)으로 폴백 — 좌표 커버리지가 부분적이어도 항상 뭔가는 생성된다.
     *
     * <p><b>전역 커버리지</b>: source 가 {@link #MAX_OD_SOURCES} 를 넘으면(대형 bbox) 앞쪽
     * 목록순 상한 대신 <b>등간격 표본추출(stride sampling)</b>로 골라 — 리스트 순서가
     * 지리적으로 한쪽에 몰려 있어도(타일 처리 순서 등) bbox 전역이 대표되게 한다.
     *
     * <p>⚠️ 규모가 클수록 route-generator 전체쌍 계산량과, 실측 확인된 원인불명 개별 터미널
     * 크래시(NextSimRunner 크래시 자동복구 대상)에 노출될 확률이 함께 늘어난다 — 상한을 둔
     * 이유. 임포트 직후 실행이 눈에 보이는 결과를 내기 위한 자리표시자이며, 실제 수요는
     * OD 매트릭스 메뉴에서 편집한다. (형식은 배포판 부천 odmatrix.xml 관례: source 전부
     * out포트, sink 전부 in포트로 완전히 분리, 뒤섞인 사례 0건)
     */
    public static String buildSampleOdMatrix(List<Long> sourceTerminalIds, List<Long> sinkTerminalIds,
                                              java.util.Map<Long, double[]> terminalLocalCoords) {
        StringBuilder demands = new StringBuilder();
        if (sourceTerminalIds != null && !sourceTerminalIds.isEmpty()
                && sinkTerminalIds != null && !sinkTerminalIds.isEmpty()) {
            int sinkCount = sinkTerminalIds.size();
            int perSource = Math.min(SINKS_PER_SOURCE, sinkCount);

            List<Long> selectedSources = strideSample(sourceTerminalIds, MAX_OD_SOURCES);
            for (int i = 0; i < selectedSources.size(); i++) {
                long src = selectedSources.get(i);
                double[] srcXy = terminalLocalCoords == null ? null : terminalLocalCoords.get(src);

                List<Integer> sinkOrder = srcXy == null ? List.of()
                        : nearestSinkIndices(srcXy, sinkTerminalIds, terminalLocalCoords, perSource);
                boolean distanceAware = !sinkOrder.isEmpty();
                if (!distanceAware) {
                    List<Integer> fallback = new java.util.ArrayList<>();
                    java.util.Set<Integer> used = new java.util.LinkedHashSet<>();
                    for (int k = 0; k < perSource; k++) {
                        int idx = (i * 7 + k * 13) % sinkCount; // 결정적 회전 — 거리 정보 없을 때 폴백
                        if (used.add(idx)) fallback.add(idx);
                    }
                    sinkOrder = fallback;
                }

                for (int rank = 0; rank < sinkOrder.size(); rank++) {
                    int sinkIdx = sinkOrder.get(rank);
                    long sink = sinkTerminalIds.get(sinkIdx);
                    int flow;
                    if (distanceAware) {
                        double[] snkXy = terminalLocalCoords.get(sink);
                        double dist = Math.hypot(srcXy[0] - snkXy[0], srcXy[1] - snkXy[1]);
                        flow = distanceDecayFlow(dist);
                    } else {
                        flow = MIN_FLOW + ((i * 7 + rank * 3) % (MAX_FLOW - MIN_FLOW));
                    }
                    appendDemand(demands, src, sink, flow);
                }
            }
        }
        return xml(
                "<!-- 네트워크 가져오기 시 자동 생성된 샘플 수요입니다. OD 매트릭스 메뉴에서 수정하세요. -->\n" +
                "<Demands>\n" +
                "  <odMatrix id=\"0\" startTime=\"00:00:00\" duration=\"60\">\n" +
                "    <avodMatrix/>\n" +
                "    <nvodMatrix>\n" +
                demands +
                "    </nvodMatrix>\n" +
                "  </odMatrix>\n" +
                "</Demands>");
    }

    /** count 이하면 그대로, 넘으면 등간격으로 골라 리스트 순서 편향(지리적 쏠림) 없이 상한 적용 */
    private static List<Long> strideSample(List<Long> items, int count) {
        if (items.size() <= count) return items;
        List<Long> result = new java.util.ArrayList<>(count);
        double stride = (double) items.size() / count;
        for (int i = 0; i < count; i++) {
            result.add(items.get((int) (i * stride)));
        }
        return result;
    }

    /** srcXy 에서 가장 가까운 sink 후보 최대 perSource 개의 인덱스(가까운 순) — 좌표 없는 sink 는 제외 */
    private static List<Integer> nearestSinkIndices(double[] srcXy, List<Long> sinkTerminalIds,
                                                     java.util.Map<Long, double[]> coords, int perSource) {
        List<int[]> candidates = new java.util.ArrayList<>(); // [index], 거리는 별도 정렬 키로 사용
        List<double[]> dists = new java.util.ArrayList<>();
        for (int idx = 0; idx < sinkTerminalIds.size(); idx++) {
            double[] snkXy = coords.get(sinkTerminalIds.get(idx));
            if (snkXy == null) continue;
            double d = Math.hypot(srcXy[0] - snkXy[0], srcXy[1] - snkXy[1]);
            candidates.add(new int[]{idx});
            dists.add(new double[]{d});
        }
        List<Integer> order = new java.util.ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) order.add(i);
        order.sort(java.util.Comparator.comparingDouble(i -> dists.get(i)[0]));
        List<Integer> result = new java.util.ArrayList<>(Math.min(perSource, order.size()));
        for (int i = 0; i < Math.min(perSource, order.size()); i++) {
            result.add(candidates.get(order.get(i))[0]);
        }
        return result;
    }

    /** 거리 반비례 flow — 가까우면 MAX_FLOW 근처, REF_DIST_M 의 몇 배씩 멀어지면 MIN_FLOW 로 수렴 */
    private static int distanceDecayFlow(double distanceM) {
        double ratio = REF_DIST_M / Math.max(distanceM, REF_DIST_M / 4.0); // 너무 가까워 폭주하지 않도록 하한
        double flow = MIN_FLOW + (MAX_FLOW - MIN_FLOW) * Math.min(1.0, ratio);
        return (int) Math.round(flow);
    }

    private static void appendDemand(StringBuilder sb, long source, long sink, int flow) {
        sb.append("      <demand source=\"").append(source)
          .append("\" sink=\"").append(sink)
          .append("\" flow=\"").append(flow)
          .append("\" dist=\"\"/>\n");
    }

    private static String xml(String body) {
        return "<?xml version='1.0' encoding='UTF-8'?>\n" + body + "\n";
    }
}
