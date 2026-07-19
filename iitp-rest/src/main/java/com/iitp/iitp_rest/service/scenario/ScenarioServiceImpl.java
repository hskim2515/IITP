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
        // scenario 직접 조회 → 없으면 version key 로 부모 scenario 해석 (좌표 등 시나리오 속성용).
        return scenarioRepository.findByKey(key)
                .or(() -> versionRepository.findByKeyWithScenario(key).map(ScenarioVersion::getScenario))
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
        if (!scenarioRepository.existsById(id)) {
            throw new IllegalArgumentException("Scenario not found: " + id);
        }
        scenarioRepository.deleteById(id);
    }

    @Override
    public boolean existsByKey(String key) {
        return scenarioRepository.existsByKey(key);
    }

    @Override
    public void updateCoordinatesByKey(String key, double latitude, double longitude) {
        // versionKey일 수도 있으므로 ScenarioVersion → Scenario 순으로 조회
        Scenario scenario = versionRepository.findByKey(key)
                .map(ScenarioVersion::getScenario)
                .orElseGet(() -> scenarioRepository.findByKey(key).orElse(null));
        if (scenario == null) {
            log.warn("[ScenarioService] updateCoordinatesByKey: key={}에 해당하는 시나리오를 찾을 수 없습니다.", key);
            return;
        }
        scenario.setLatitude(latitude);
        scenario.setLongitude(longitude);
        scenarioRepository.save(scenario);
        log.info("[ScenarioService] 시나리오 좌표 업데이트: key={}, lat={}, lon={}", scenario.getKey(), latitude, longitude);
    }

    @Override
    public ScenarioVersion createVersion(Long scenarioId, String key, String label) {
        if (!key.matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("버전 키는 영문자, 숫자, 밑줄(_)만 허용됩니다.");
        }
        if (versionRepository.findByKey(key).isPresent()) {
            throw new IllegalArgumentException("이미 사용 중인 버전 키입니다: " + key);
        }
        Scenario scenario = scenarioRepository.findById(scenarioId)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + scenarioId));
        ScenarioVersion version = ScenarioVersion.builder()
                .scenario(scenario)
                .key(key)
                .label(label)
                .insertDate(java.time.LocalDateTime.now())
                .build();
        return versionRepository.save(version);
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

