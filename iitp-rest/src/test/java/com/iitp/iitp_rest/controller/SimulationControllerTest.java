package com.iitp.iitp_rest.controller;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * classifyStep()/computeProgress() 순수 정적 로직 검증 — 프론트 NextSim 준비 상태 배지의
 * 단계 체크리스트/진행률·ETA 표시가 여기 의존한다(NextSimReadinessBadge.tsx).
 *
 * <p>classifyStep 리터럴은 NextSimRunner.java 의 실제 progress.accept(...) 문구를 그대로
 * 복사한 것 — 두 파일이 따로 수정되면 이 테스트가 문구 드리프트를 잡아준다.
 */
class SimulationControllerTest {

    private static String classifyStep(String stage) throws Exception {
        Method m = SimulationController.class.getDeclaredMethod("classifyStep", String.class);
        m.setAccessible(true);
        return (String) m.invoke(null, (Object) stage);
    }

    private static Object computeProgress(long elapsedSeconds, long historySeconds) throws Exception {
        Method m = SimulationController.class.getDeclaredMethod("computeProgress", long.class, long.class);
        m.setAccessible(true);
        return m.invoke(null, elapsedSeconds, historySeconds);
    }

    private static int percentOf(Object est) throws Exception {
        Method m = est.getClass().getDeclaredMethod("percent");
        m.setAccessible(true);
        return (int) m.invoke(est);
    }

    private static long etaOf(Object est) throws Exception {
        Method m = est.getClass().getDeclaredMethod("etaSeconds");
        m.setAccessible(true);
        return (long) m.invoke(est);
    }

    @Test
    void classifiesStagingMessage() throws Exception {
        assertThat(classifyStep("입력 데이터 스테이징 중...")).isEqualTo("STAGING");
    }

    @Test
    void classifiesValidatingMessage() throws Exception {
        assertThat(classifyStep("네트워크 정합성 보정 중 (고립 노드 격리 · 도달 가능성 검증)...")).isEqualTo("VALIDATING");
    }

    @Test
    void classifiesRouteGenMessages() throws Exception {
        assertThat(classifyStep("경로 캐시 재사용 — 경로 생성 생략")).isEqualTo("ROUTE_GEN");
        assertThat(classifyStep("경로 생성 중 (route-generator)...")).isEqualTo("ROUTE_GEN");
        assertThat(classifyStep("RouteGenerator 크래시 복구 — 구간 테스트 (12개)")).isEqualTo("ROUTE_GEN");
        assertThat(classifyStep("RouteGenerator 크래시 복구 — 노드 11000357 병합 시도")).isEqualTo("ROUTE_GEN");
    }

    @Test
    void classifiesSimulationMessages() throws Exception {
        assertThat(classifyStep("시뮬레이션 실행 중 (nextsim)...")).isEqualTo("SIMULATION");
        assertThat(classifyStep("Simulation 크래시 복구 — 구간 테스트 (4개)")).isEqualTo("SIMULATION");
    }

    @Test
    void classifiesSavingMessage() throws Exception {
        assertThat(classifyStep("결과 저장 중...")).isEqualTo("SAVING");
    }

    @Test
    void unclassifiableRawLogReturnsNull() throws Exception {
        // runStage() 가 그대로 흘려보내는 바이너리 stdout 원시 라인 형태 (한국어 접두어와 무관)
        assertThat(classifyStep("[INFO] doctest: Route.json generated, 128340 routes")).isNull();
        assertThat(classifyStep(null)).isNull();
    }

    @Test
    void computeProgressReturnsNullWhenNoHistory() throws Exception {
        assertThat(computeProgress(30, 0)).isNull();
        assertThat(computeProgress(30, -5)).isNull();
    }

    @Test
    void computeProgressMidRange() throws Exception {
        Object est = computeProgress(30, 120);
        assertThat(percentOf(est)).isEqualTo(25);
        assertThat(etaOf(est)).isEqualTo(90);
    }

    @Test
    void computeProgressClampsAtElapsedEqualsHistory() throws Exception {
        Object est = computeProgress(120, 120);
        assertThat(percentOf(est)).isEqualTo(99);
        assertThat(etaOf(est)).isEqualTo(0);
    }

    @Test
    void computeProgressClampsWhenOverrun() throws Exception {
        // 크래시 복구 등으로 이력보다 훨씬 오래 걸리는 경우 — 100% 이상으로 폭주하면 안 됨
        Object est = computeProgress(600, 120);
        assertThat(percentOf(est)).isEqualTo(99);
        assertThat(etaOf(est)).isEqualTo(0);
    }
}
