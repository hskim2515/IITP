package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.signal.SignalResponse;
import com.iitp.iitp_rest.model.signal.SignalSaveRequest;
import com.iitp.iitp_rest.model.signal.SignalVersion;
import com.iitp.iitp_rest.model.signal.SignalXml;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import com.iitp.iitp_rest.service.signal.SignalJaxbParser;
import com.iitp.iitp_rest.service.signal.SignalService;
import com.iitp.iitp_rest.service.signal.SignalTileService;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 새 버전 생성 시 원본 버전의 NextSim 입력 파일을 새 버전 폴더로 실제 복사한다.
 *
 * <p>{@code createVersion}은 DB에 버전 레코드만 만들 뿐 SFTP 파일은 건드리지 않는다.
 * 각 데이터 서비스(OdMatrixService 등)의 "버전 폴더에 없으면 시나리오 base key로 폴백"
 * 조회 방식과 맞물려, 지금까지는 이렇게 만들어진 새 버전이 자신이 분기해온 버전이 아니라
 * 훨씬 오래된 시나리오 base 데이터를 조용히 물려받는 문제가 있었다(예: scenario2_1의
 * 233노드 네트워크를 보다가 새 버전을 만들면, 그 버전은 scenario2 base의 11298노드
 * 네트워크를 보게 됨).
 *
 * <p>DB 캐시({@code XmlLayerVersion}, {@code SignalVersion} 등)는 복사하지 않는다 — 새
 * 버전에 해당 DB row가 없으면 "DB 우선, 없으면 XML" 조회 경로가 자동으로 여기서 복사한
 * 파일을 읽어오고, 히스토리 복원도 새 버전에서 깨끗하게 새로 시작된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScenarioVersionCloneService {

    private final FileStorageService fileStorage;
    private final ScenarioVersionRepository scenarioVersionRepository;
    private final SignalService signalService;
    private final SignalVersionsRepository signalVersionsRepository;
    private final SignalJaxbParser signalJaxbParser;
    // ⚠️ destVersionKey가 과거 삭제된 버전 key를 재사용하는 경우, 그 key로 남아있던 신호
    // 타일 캐시가 있으면 무효화 없이는 방금 복사한 신호가 아니라 옛 데이터가 계속 서빙된다
    // (KtdbImportController의 signal.xml 재생성 시 무효화 누락과 동일한 이유로 추가).
    private final SignalTileService signalTileService;

    /** true인 파일은 (network.xml처럼) 자기 버전 폴더에 없으면 실패 — 폴백 없음.
     *  false인 파일은 OdMatrixService 등과 동일하게 "버전 폴더 → 시나리오 base key" 순으로 찾는다.
     *  signal.xml은 여기 포함하지 않는다 — DB(SignalVersion)에 XML보다 더 정확한 편집 데이터가
     *  있을 수 있어 raw 파일 복사만으로는 불충분, cloneSignal()에서 별도 처리(DB 우선 조회 → 재저장). */
    private static final Map<String, Boolean> CLONE_FILES = new LinkedHashMap<>();
    static {
        CLONE_FILES.put("network.xml", false);
        CLONE_FILES.put("signalTOD.xml", true);
        CLONE_FILES.put("odmatrix.xml", true);
        CLONE_FILES.put("passenger.xml", true);
        CLONE_FILES.put("scenario.xml", true);
    }

    public void cloneFiles(String sourceVersionKey, String destVersionKey) {
        cloneSignal(sourceVersionKey, destVersionKey);
        for (Map.Entry<String, Boolean> entry : CLONE_FILES.entrySet()) {
            String fileName = entry.getKey();
            boolean useScenarioFallback = entry.getValue();
            try {
                Optional<byte[]> bytes = resolveEffectiveBytes(sourceVersionKey, fileName, useScenarioFallback);
                if (bytes.isEmpty()) {
                    log.info("[ScenarioVersionCloneService] {} 없음(건너뜀): source={}", fileName, sourceVersionKey);
                    continue;
                }
                fileStorage.uploadFile(new ByteArrayInputStream(bytes.get()), destVersionKey, fileName);
                log.info("[ScenarioVersionCloneService] {} 복사 완료: {} -> {}", fileName, sourceVersionKey, destVersionKey);
            } catch (Exception e) {
                log.warn("[ScenarioVersionCloneService] {} 복사 실패(건너뜀): {} -> {}: {}",
                        fileName, sourceVersionKey, destVersionKey, e.getMessage());
            }
        }
    }

    private Optional<byte[]> resolveEffectiveBytes(String versionKey, String fileName, boolean useScenarioFallback)
            throws IOException {
        for (String dir : candidateDirs(versionKey, useScenarioFallback)) {
            String path = dir + "/" + fileName;
            if (fileStorage.exists(path)) {
                return Optional.of(fileStorage.readFile(path));
            }
        }
        return Optional.empty();
    }

    /** OdMatrixService/PassengerService/SignalTodService/SimulationRunService와 동일 규약. */
    private List<String> candidateDirs(String versionKey, boolean useScenarioFallback) {
        if (!useScenarioFallback) return List.of(versionKey);
        String parentKey = scenarioVersionRepository.findByKeyWithScenario(versionKey)
                .map(v -> v.getScenario().getKey())
                .orElse(versionKey);
        return parentKey.equals(versionKey) ? List.of(versionKey) : List.of(versionKey, parentKey);
    }

    /**
     * SignalController.getSignal과 동일한 "DB 우선, 없으면 XML" 판단으로 원본 버전의 실제
     * 신호 데이터를 읽어서, SignalController.saveSignal과 동일한 경로(DB LATEST/ORIGIN 갱신 +
     * signal.xml 재기록)로 새 버전에 그대로 다시 저장한다. signal.xml만 raw 복사하면 DB에만
     * 있던 plans(신호 주기/현시) 등이 유실된다(실측).
     */
    private void cloneSignal(String sourceVersionKey, String destVersionKey) {
        try {
            Optional<SignalVersion> latest = signalVersionsRepository
                    .findByVersionIdAndVersionRole(sourceVersionKey, BaseVersion.VersionRole.LATEST);
            boolean hasDbData = latest.isPresent() && latest.get().getData() != null && !latest.get().getData().isEmpty();
            List<SignalResponse> signals = hasDbData
                    ? latest.get().getData()
                    : signalService.getDataFromXml(sourceVersionKey);
            if (signals == null || signals.isEmpty()) {
                log.info("[ScenarioVersionCloneService] signal 없음(건너뜀): source={}", sourceVersionKey);
                return;
            }
            SignalSaveRequest request = new SignalSaveRequest();
            request.setData(signals);
            request.setLogs(new LogsData());
            signalService.saveSignal(request, destVersionKey);
            // SignalController.saveSignal과 동일하게 DB 저장과 별개로 signal.xml도 명시적으로 동기화
            // (SignalService.saveSignal은 DB만 갱신하고 XML 파일은 건드리지 않음)
            SignalXml xml = signalService.toSignalXml(signals);
            byte[] xmlBytes = signalJaxbParser.marshal(xml);
            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), destVersionKey, "signal.xml");
            try {
                signalTileService.invalidate(destVersionKey);
                signalTileService.ingest(destVersionKey, signals);
            } catch (Exception e) {
                log.warn("[ScenarioVersionCloneService] 신호 타일 캐시 재빌드 실패 (lazy 빌드로 폴백): {}", e.getMessage());
            }
            log.info("[ScenarioVersionCloneService] signal 복사 완료 ({}건): {} -> {}", signals.size(), sourceVersionKey, destVersionKey);
        } catch (Exception e) {
            log.warn("[ScenarioVersionCloneService] signal 복사 실패(건너뜀): {} -> {}: {}",
                    sourceVersionKey, destVersionKey, e.getMessage());
        }
    }
}
