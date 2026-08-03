package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;

import java.util.List;

public interface ScenarioService {
    List<Scenario> getAllScenarios();
    Scenario getScenarioById(Long id);
    List<ScenarioVersion> getVersionsByScenarioId(Long scenarioId);
    Scenario getScenarioByKey(String key);
    ScenarioVersion getVersionByKey(String key);
    Scenario createScenario(Scenario scenario);
    Scenario updateScenario(Long id, Scenario scenario);
    void deleteScenario(Long id);
    boolean existsByKey(String key);
    ScenarioVersion createVersion(Long scenarioId, String key, String label, String sourceVersionKey);
    void deleteVersion(Long scenarioId, Long versionId);
    /** 버전 레코드는 유지한 채 그 버전에 딸린 모든 산출물(네트워크/신호/OD/승객/차량시뮬 등)만 비운다.
     *  같은 versionKey로 바로 새 데이터를 가져오기/편집할 수 있다 — deleteVersion과 달리
     *  DB의 ScenarioVersion 행 자체와 좌표/회전/축척 캘리브레이션은 그대로 남는다. */
    void resetVersionData(String versionKey);
    void updateCoordinatesByKey(String key, double latitude, double longitude);
    /** rotationDeg/scale 이 null이면 기존 값을 건드리지 않는다 (호출부가 "회전/축척은 모름"인 경우). */
    void updateCoordinatesByKey(String key, double latitude, double longitude, Double rotationDeg, Double scale);
    /**
     * 이전 캘리브레이션(base_rotation/base_scale)을 명시적으로 지운다(null로) — 좌표(lat/lon)는
     * 건드리지 않는다. network.xml이 통째로 새로 들어오는 "네트워크 재생성" 호출부(KTDB/OSM/SUMO
     * 재임포트, 원본 XML 파일 재업로드)에서 써야 한다 — 새 network.xml 자체는 옛 네트워크 기준으로
     * 계산된 회전/축척과 무관한 새 좌표계인데, 이 값을 안 지우면 도로(network.xml 자체 값 우선,
     * 없으면 0°/1.0 고정)와 차량(network.xml에 없으면 이 시나리오 값으로 폴백)이 서로 다른 회전/
     * 축척을 적용받아 지도 전체에 걸쳐 어긋나 보인다(실측 확인: scenario3_1). reanchor(위치만
     * 이동, 회전/축척 보존 의도)·calibrate(새 회전/축척을 직접 계산해 즉시 채움)에서는 호출하면
     * 안 된다 — 그 두 경로는 이 값을 지우는 게 아니라 의도적으로 유지/갱신하는 것이 맞다.
     */
    void clearCalibration(String key);
}

