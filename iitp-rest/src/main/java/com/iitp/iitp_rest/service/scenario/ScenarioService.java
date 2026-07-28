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
}

