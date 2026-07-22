package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class ScenarioServiceImpl implements ScenarioService {

    private final ScenarioRepository scenarioRepository;
    private final ScenarioVersionRepository versionRepository;
    private final FileStorageService fileStorage;
    private final ScenarioVersionCloneService versionCloneService;
    private final ScenarioVersionPurgeService versionPurgeService;

    @Override
    public List<Scenario> getAllScenarios() {
        return scenarioRepository.findAll();
    }

    @Override
    public Scenario getScenarioById(Long id) {
        return scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
    }

    @Override
    public List<ScenarioVersion> getVersionsByScenarioId(Long scenarioId) {
        return versionRepository.findByScenarioId(scenarioId);
    }

    @Override
    public Scenario getScenarioByKey(String key) {
        // 버전별 격리 이후 호출측(차량 생성/viewport/임포트)은 version key 를 넘긴다.
        // scenario 직접 조회 → 없으면 version key 로 해석하되, 좌표/회전/축척은 버전 자체
        // 캘리브레이션 값을 우선 사용한다(toEffectiveScenario) — 그렇지 않으면 한 버전을
        // 캘리브레이션했을 때 부모 Scenario에 저장된 값이 같은 시나리오의 다른 버전에도
        // 적용되어 그 버전의 차량 시뮬레이션/시설물이 어긋나 보이는 문제가 생긴다.
        return scenarioRepository.findByKey(key)
                .or(() -> versionRepository.findByKeyWithScenario(key).map(ScenarioVersion::toEffectiveScenario))
                .orElseThrow(() -> new RuntimeException("Scenario not found key: " + key));
    }

    @Override
    public ScenarioVersion getVersionByKey(String key) {
        return versionRepository.findByKey(key)
                .orElseThrow(() -> new RuntimeException("ScenarioVersion not found key: " + key));
    }

    @Override
    public Scenario updateScenario(Long id, Scenario patch) {
        Scenario existing = scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
        existing.setLabel(patch.getLabel());
        existing.setDescription(patch.getDescription());
        existing.setLongitude(patch.getLongitude());
        existing.setLatitude(patch.getLatitude());
        return scenarioRepository.save(existing);
    }

    @Override
    public void deleteScenario(Long id) {
        Scenario scenario = scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
        // 버전 key 목록을 삭제 전에 확보 (삭제 후에는 조회 불가)
        List<String> versionKeys = versionRepository.findByScenarioId(id).stream()
                .map(ScenarioVersion::getKey).toList();
        String scenarioKey = scenario.getKey();

        scenarioRepository.deleteById(id);

        // 연쇄 정리 — 전 버전 폴더 + 시나리오 base key 폴더까지 (best-effort)
        for (String key : versionKeys) versionPurgeService.purgeVersionData(key);
        if (scenarioKey != null && !versionKeys.contains(scenarioKey)) {
            versionPurgeService.purgeVersionData(scenarioKey);
        }
    }

    @Override
    public boolean existsByKey(String key) {
        return scenarioRepository.existsByKey(key);
    }

    @Override
    public void updateCoordinatesByKey(String key, double latitude, double longitude) {
        // 회전/축척은 건드리지 않음 — OSM/KTDB/SUMO 임포트 등 기존 호출부는 애초에 회전/축척
        // 개념이 없던 경로라, 여기서 null로 리셋하면 그 사이 캘리브레이션된 값을 실수로 지울 수 있다.
        updateCoordinatesByKey(key, latitude, longitude, null, null);
    }

    @Override
    public void updateCoordinatesByKey(String key, double latitude, double longitude, Double rotationDeg, Double scale) {
        // versionKey로 먼저 조회 — 네트워크 캘리브레이션(reanchor/calibrate)은 버전별 network.xml
        // 단위로 이루어지므로, 좌표/회전/축척도 부모 Scenario가 아니라 이 ScenarioVersion 자체에
        // 저장해야 한다. 부모에 저장하면 같은 시나리오의 다른 버전에도 이 캘리브레이션이 새어
        // 들어가 그 버전의 차량 시뮬레이션·시설물이 실제로는 캘리브레이션 안 됐는데도 회전/확대
        // 되어 보이는 문제가 생긴다.
        java.util.Optional<ScenarioVersion> versionOpt = versionRepository.findByKey(key);
        if (versionOpt.isPresent()) {
            ScenarioVersion version = versionOpt.get();
            version.setLatitude(latitude);
            version.setLongitude(longitude);
            if (rotationDeg != null) version.setBaseRotation(rotationDeg);
            if (scale != null) version.setBaseScale(scale);
            versionRepository.save(version);
            log.info("[ScenarioService] 버전 좌표 업데이트: versionKey={}, lat={}, lon={}, rotation={}, scale={}",
                    key, latitude, longitude, rotationDeg, scale);
            return;
        }

        // versionKey로 못 찾으면(예: 버전이 아직 없는 신규 scenario key) 부모 Scenario에 기록 —
        // 이후 생성되는 첫 버전이 캘리브레이션 전까지 이 값을 기본값으로 상속한다.
        Scenario scenario = scenarioRepository.findByKey(key).orElse(null);
        if (scenario == null) {
            log.warn("[ScenarioService] updateCoordinatesByKey: key={}에 해당하는 시나리오/버전을 찾을 수 없습니다.", key);
            return;
        }
        scenario.setLatitude(latitude);
        scenario.setLongitude(longitude);
        if (rotationDeg != null) scenario.setBaseRotation(rotationDeg);
        if (scale != null) scenario.setBaseScale(scale);
        scenarioRepository.save(scenario);
        log.info("[ScenarioService] 시나리오 좌표 업데이트: key={}, lat={}, lon={}, rotation={}, scale={}",
                scenario.getKey(), latitude, longitude, rotationDeg, scale);
    }

    @Override
    public ScenarioVersion createVersion(Long scenarioId, String key, String label, String sourceVersionKey) {
        if (!key.matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("버전 키는 영문자, 숫자, 밑줄(_)만 허용됩니다.");
        }
        if (versionRepository.findByKey(key).isPresent()) {
            throw new IllegalArgumentException("이미 사용 중인 버전 키입니다: " + key);
        }
        Scenario scenario = scenarioRepository.findById(scenarioId)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + scenarioId));

        // 분기 원본 버전의 캘리브레이션(좌표/회전/축척)을 물려받는다 — 이걸 안 물려받으면
        // 복사해온 network.xml의 원본 좌표가 부모 Scenario 기본 캘리브레이션으로 잘못 변환된다.
        ScenarioVersion.ScenarioVersionBuilder builder = ScenarioVersion.builder()
                .scenario(scenario)
                .key(key)
                .label(label)
                .insertDate(java.time.LocalDateTime.now());
        if (sourceVersionKey != null) {
            versionRepository.findByKey(sourceVersionKey).ifPresent(src -> builder
                    .baseRotation(src.getBaseRotation())
                    .baseScale(src.getBaseScale())
                    .latitude(src.getLatitude())
                    .longitude(src.getLongitude()));
        }
        ScenarioVersion version = versionRepository.save(builder.build());

        if (sourceVersionKey != null && !sourceVersionKey.equals(key)) {
            versionCloneService.cloneFiles(sourceVersionKey, key);
        }
        return version;
    }

    @Override
    public void deleteVersion(Long scenarioId, Long versionId) {
        ScenarioVersion version = versionRepository.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("Version not found: " + versionId));
        if (!version.getScenario().getId().equals(scenarioId)) {
            throw new IllegalArgumentException("Version does not belong to scenario: " + scenarioId);
        }
        List<ScenarioVersion> siblings = versionRepository.findByScenarioId(scenarioId);
        if (siblings.size() <= 1) {
            throw new IllegalArgumentException("마지막 버전은 삭제할 수 없습니다.");
        }
        versionRepository.deleteById(versionId);
        log.info("[ScenarioService] 버전 삭제: id={}, key={}", versionId, version.getKey());

        // 연쇄 정리 — 이 버전 key에 딸린 SFTP 폴더/DB 캐시/타일 DB 전부 (best-effort,
        // 실패해도 버전 삭제 자체는 이미 완료된 상태를 유지)
        versionPurgeService.purgeVersionData(version.getKey());
    }

    @Override
    public Scenario createScenario(Scenario scenario) {
        if (!scenario.getKey().matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("시나리오 키는 영문자, 숫자, 밑줄(_)만 허용됩니다.");
        }
        if (scenarioRepository.existsByKey(scenario.getKey())) {
            throw new IllegalArgumentException("이미 사용 중인 키입니다: " + scenario.getKey());
        }
        Scenario saved = scenarioRepository.save(scenario);

        // 기본 버전 1 자동 생성
        ScenarioVersion defaultVersion = ScenarioVersion.builder()
                .scenario(saved)
                .key(saved.getKey() + "_V1")
                .label("버전 1")
                .insertDate(java.time.LocalDateTime.now())
                .build();
        versionRepository.save(defaultVersion);
        log.info("기본 버전 생성 완료: {}", defaultVersion.getKey());

        try {
            fileStorage.createDirectory(saved.getKey());
            log.info("시나리오 디렉토리 생성 완료: {}", saved.getKey());
        } catch (Exception e) {
            log.warn("시나리오 디렉토리 생성 실패 (DB 저장은 유지): {}", e.getMessage());
        }
        return saved;
    }
}

