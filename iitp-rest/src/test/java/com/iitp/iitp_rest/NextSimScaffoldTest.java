package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.service.simulation.NextSimInputScaffolder;
import jakarta.xml.bind.JAXBContext;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * NextSim 입력 스캐폴딩 검증 — 자동 생성 odmatrix.xml 이
 * OD 매트릭스 UI(OdMatrixService/JAXB)와 러너 양쪽에서 소비 가능한 형식인지,
 * source(out포트 터미널)/sink(in포트 터미널) 방향이 실제 부천 참조 데이터 관례와 일치하는지.
 */
class NextSimScaffoldTest {

    private OdMatrixXml parse(String xml) throws Exception {
        return (OdMatrixXml) JAXBContext.newInstance(OdMatrixXml.class)
                .createUnmarshaller()
                .unmarshal(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void sample_od_pairs_only_sources_with_sinks() throws Exception {
        String xml = NextSimInputScaffolder.buildSampleOdMatrix(
                List.of(101L, 202L, 303L), List.of(901L, 902L));
        OdMatrixXml od = parse(xml);

        assertNotNull(od.getOdMatrices());
        var demands = od.getOdMatrices().get(0).getNvodMatrix().getDemands();
        // 3 source 전부 사용, source 당 sink 후보(2개) 전부와 연결(회전 오프셋 분산)
        assertEquals(6, demands.size());
        Set<String> sourcePool = Set.of("101", "202", "303");
        Set<String> sinkPool = Set.of("901", "902");
        for (var d : demands) {
            assertTrue(sourcePool.contains(d.getSource()), "source 는 항상 source 후보 풀에서만");
            assertTrue(sinkPool.contains(d.getSink()), "sink 는 항상 sink 후보 풀에서만");
            assertTrue(d.getFlow() != null && d.getFlow() > 0,
                    "모든 샘플 수요는 flow>0 (러너 requirePositiveDemand 통과 조건)");
        }
    }

    @Test
    void large_pool_yields_bucheon_scale_density() throws Exception {
        List<Long> sources = new java.util.ArrayList<>();
        List<Long> sinks = new java.util.ArrayList<>();
        for (long i = 0; i < 300; i++) sources.add(1000L + i);
        for (long i = 0; i < 300; i++) sinks.add(9000L + i);
        String xml = NextSimInputScaffolder.buildSampleOdMatrix(sources, sinks);
        var demands = parse(xml).getOdMatrices().get(0).getNvodMatrix().getDemands();
        // 상한: source 200개 x sink 15개 = 최대 3000쌍(부천 규모 "수백 터미널, 수천 쌍" 목표)
        assertTrue(demands.size() > 1000 && demands.size() <= 3000,
                "부천 규모 밀도를 목표로 함 (실제: " + demands.size() + ")");
    }

    @Test
    void single_source_and_sink_yield_one_demand() throws Exception {
        String xml = NextSimInputScaffolder.buildSampleOdMatrix(List.of(7L), List.of(9L));
        var demands = parse(xml).getOdMatrices().get(0).getNvodMatrix().getDemands();
        assertEquals(1, demands.size());
        assertEquals("7", demands.get(0).getSource());
        assertEquals("9", demands.get(0).getSink());
    }

    /* ── 거리 인지 OD 생성 — 좌표가 있으면 근접 sink 우선 + 거리 감쇠 flow ── */

    @Test
    void nearest_sink_preferred_when_coords_given() throws Exception {
        // source(1L)=(0,0). sink 900L=(100,0) 가까움, sink 901L=(10000,0) 아주 멂.
        // perSource 상한(1개)만 요청되도록 sink 후보를 2개만 둔 뒤 결과가 가까운 쪽만 골랐는지 확인.
        java.util.Map<Long, double[]> coords = new java.util.HashMap<>();
        coords.put(1L, new double[]{0, 0});
        coords.put(900L, new double[]{100, 0});
        coords.put(901L, new double[]{10000, 0});
        String xml = NextSimInputScaffolder.buildSampleOdMatrix(List.of(1L), List.of(901L, 900L), coords);
        var demands = parse(xml).getOdMatrices().get(0).getNvodMatrix().getDemands();
        // perSource = min(15, sinkCount=2) = 2 → 둘 다 포함되지만, 가까운 900L 의 flow 가 더 커야 함
        assertEquals(2, demands.size());
        double flowNear = demands.stream().filter(d -> "900".equals(d.getSink())).findFirst().get().getFlow();
        double flowFar  = demands.stream().filter(d -> "901".equals(d.getSink())).findFirst().get().getFlow();
        assertTrue(flowNear > flowFar, "가까운 sink 의 flow 가 더 커야 함 (거리 감쇠): near=" + flowNear + " far=" + flowFar);
    }

    @Test
    void missing_coords_falls_back_to_rotation() throws Exception {
        // 좌표를 아예 안 주면(3-arg 오버로드에 null) 기존 결정적 회전 방식과 동일하게 동작해야 함
        String withNullCoords = NextSimInputScaffolder.buildSampleOdMatrix(
                List.of(101L, 202L, 303L), List.of(901L, 902L), null);
        String legacyTwoArg = NextSimInputScaffolder.buildSampleOdMatrix(
                List.of(101L, 202L, 303L), List.of(901L, 902L));
        var d1 = parse(withNullCoords).getOdMatrices().get(0).getNvodMatrix().getDemands();
        var d2 = parse(legacyTwoArg).getOdMatrices().get(0).getNvodMatrix().getDemands();
        assertEquals(d2.size(), d1.size());
        for (int i = 0; i < d1.size(); i++) {
            assertEquals(d2.get(i).getSource(), d1.get(i).getSource());
            assertEquals(d2.get(i).getSink(), d1.get(i).getSink());
            assertEquals(d2.get(i).getFlow(), d1.get(i).getFlow());
        }
    }

    @Test
    void partial_coord_coverage_falls_back_per_source() throws Exception {
        // source 1L 은 좌표 있음(거리 인지), source 2L 은 좌표 없음(회전 폴백) — 둘 다 수요가 나와야 함
        java.util.Map<Long, double[]> coords = new java.util.HashMap<>();
        coords.put(1L, new double[]{0, 0});
        coords.put(900L, new double[]{50, 0});
        // 2L, 901L 좌표는 의도적으로 누락
        String xml = NextSimInputScaffolder.buildSampleOdMatrix(List.of(1L, 2L), List.of(900L, 901L), coords);
        var demands = parse(xml).getOdMatrices().get(0).getNvodMatrix().getDemands();
        assertTrue(demands.stream().anyMatch(d -> "1".equals(d.getSource())), "좌표 있는 source 도 수요 생성");
        assertTrue(demands.stream().anyMatch(d -> "2".equals(d.getSource())), "좌표 없는 source 도 폴백으로 수요 생성");
    }

    @Test
    void large_source_pool_beyond_cap_uses_stride_sampling_not_prefix() throws Exception {
        // source 400개(상한 200 초과) — 등간격 표본이면 마지막 근처 source 도 최소 하나는 뽑혀야 함
        // (기존 앞쪽 200개 고정 방식이면 인덱스 200 이후는 전부 누락됨)
        List<Long> sources = new java.util.ArrayList<>();
        for (long i = 0; i < 400; i++) sources.add(1000L + i);
        String xml = NextSimInputScaffolder.buildSampleOdMatrix(sources, List.of(9000L, 9001L));
        var demands = parse(xml).getOdMatrices().get(0).getNvodMatrix().getDemands();
        boolean hasLateSource = demands.stream()
                .anyMatch(d -> Long.parseLong(d.getSource()) >= 1000L + 300); // 뒤쪽 4분의1 구간
        assertTrue(hasLateSource, "등간격 표본추출로 리스트 뒤쪽 source 도 대표돼야 함");
    }

    @Test
    void empty_source_or_sink_pool_yields_no_demands() throws Exception {
        OdMatrixXml od1 = parse(NextSimInputScaffolder.buildSampleOdMatrix(List.of(), List.of(9L)));
        OdMatrixXml od2 = parse(NextSimInputScaffolder.buildSampleOdMatrix(List.of(7L), List.of()));
        for (OdMatrixXml od : List.of(od1, od2)) {
            var nvod = od.getOdMatrices().get(0).getNvodMatrix();
            assertTrue(nvod == null || nvod.getDemands() == null || nvod.getDemands().isEmpty());
        }
    }

    /* ── 재임포트 낡음 검증: 방향이 맞아야 유효, 어긋나면(재임포트로 포트 방향이 뒤집혀도) 재생성 ── */

    @Test
    void od_matrix_stale_when_direction_or_refs_wrong() {
        Set<String> sources = Set.of("101", "303");
        Set<String> sinks = Set.of("901", "902");
        String od = NextSimInputScaffolder.buildSampleOdMatrix(List.of(101L, 303L), List.of(901L, 902L));

        // 정확히 일치하는 방향 풀 → 유효
        assertTrue(NextSimInputScaffolder.odMatrixValid(od, sources, sinks));
        // 재임포트로 id 전면 교체 → 낡음
        assertFalse(NextSimInputScaffolder.odMatrixValid(od, Set.of("501"), Set.of("502")));
        // source/sink 풀이 뒤바뀌면(포트 방향이 반대로 재분류된 경우) → 낡음
        assertFalse(NextSimInputScaffolder.odMatrixValid(od, sinks, sources));
        // 수요가 아예 없으면 무효 (재생성해서 샘플 수요 확보)
        assertFalse(NextSimInputScaffolder.odMatrixValid(
                NextSimInputScaffolder.buildSampleOdMatrix(List.of(), List.of()), sources, sinks));
    }

    @Test
    void signal_stale_only_when_node_refs_broken() {
        String signal = "<?xml version=\"1.0\"?>\n<Signal>\n  <node id=\"10000009\">\n  </node>\n</Signal>";
        assertTrue(NextSimInputScaffolder.signalValid(signal, Set.of("10000009", "10000010")));
        assertFalse(NextSimInputScaffolder.signalValid(signal, Set.of("90000001")));
        // 빈 템플릿(참조 없음)은 어떤 네트워크에도 유효
        assertTrue(NextSimInputScaffolder.signalValid("<Signal id=\"0\">\n</Signal>", Set.of("1")));
        // 대조할 노드 집합이 없으면 보수적으로 유지
        assertTrue(NextSimInputScaffolder.signalValid(signal, Set.of()));
    }

    /* ── signalTOD 커버리지 검증 (scenario1_2 실전 크래시 재현: signal 은 플랜 있는데 TOD 는 공백) ── */

    private static final String SIGNAL_WITH_PLAN =
            "<?xml version=\"1.0\"?>\n<Signal>\n" +
            "  <node id=\"10000006\">\n" +
            "    <turnList><turn id=\"0\" turning=\"R\" type=\"RTOR\" connList=\"0 1\"/></turnList>\n" +
            "    <planList><plan id=\"0\" cycle=\"90\" offset=\"0\"><phase id=\"0\" duration=\"30\" turnList=\"0\"/></plan></planList>\n" +
            "  </node>\n" +
            "</Signal>";

    @Test
    void signal_tod_stale_when_plan_node_missing_from_tod() {
        Set<String> planNodes = NextSimInputScaffolder.extractSignalPlanNodeIds(SIGNAL_WITH_PLAN);
        assertEquals(Set.of("10000006"), planNodes, "plan 정의를 가진 노드만 추출");

        // scenario1_2 실전 상태 재현: signal 에 플랜 있지만 TOD 는 완전 공백 → 무효(재생성 대상)
        String emptyTod = "<?xml version='1.0'?>\n<TOD id=\"0\">\n</TOD>";
        assertFalse(NextSimInputScaffolder.signalTodValid(emptyTod, planNodes),
                "signal 에 플랜 있는 노드가 TOD 에 하나도 없으면 낡음 — nextsim std::out_of_range 크래시 원인");

        // 해당 노드의 TOD 스케줄이 실제로 있으면 유효
        String properTod = "<?xml version='1.0'?>\n<TOD id=\"0\">\n" +
                "  <node id=\"10000006\">\n    <plan id=\"0\" startTime=\"00:00:00\" endTime=\"24:00:00\"/>\n  </node>\n</TOD>";
        assertTrue(NextSimInputScaffolder.signalTodValid(properTod, planNodes));

        // 다른 노드만 커버하고 정작 필요한 노드가 빠지면 여전히 무효
        String wrongTod = "<?xml version='1.0'?>\n<TOD id=\"0\">\n" +
                "  <node id=\"99999999\">\n    <plan id=\"0\" startTime=\"00:00:00\" endTime=\"24:00:00\"/>\n  </node>\n</TOD>";
        assertFalse(NextSimInputScaffolder.signalTodValid(wrongTod, planNodes));
    }

    @Test
    void default_tod_preserves_signal_data_instead_of_blanking() throws Exception {
        // signal.xml 은 그대로 두고 TOD 만 채워야 함 — 신호 데이터를 날리지 않는 게 핵심
        Set<String> planNodes = NextSimInputScaffolder.extractSignalPlanNodeIds(SIGNAL_WITH_PLAN);
        String tod = NextSimInputScaffolder.buildDefaultSignalTod(SIGNAL_WITH_PLAN, planNodes);
        assertTrue(NextSimInputScaffolder.signalTodValid(tod, planNodes),
                "생성된 기본 TOD 는 signal.xml 의 플랜 보유 노드를 전부 커버해야 함");
        assertTrue(tod.contains("<node id=\"10000006\">"));
        assertTrue(tod.contains("plan id=\"0\""), "SIGNAL_WITH_PLAN 의 유일한 plan id=0 을 사용해야 함");
        assertTrue(tod.contains("startTime=\"00:00:00\"") && tod.contains("endTime=\"24:00:00\""));
    }

    @Test
    void default_tod_uses_min_plan_id_per_node() {
        String signal = "<?xml version=\"1.0\"?>\n<Signal>\n" +
                "  <node id=\"1\">\n    <planList><plan id=\"2\" cycle=\"90\" offset=\"0\"/><plan id=\"1\" cycle=\"90\" offset=\"0\"/></planList>\n  </node>\n" +
                "</Signal>";
        Set<String> planNodes = NextSimInputScaffolder.extractSignalPlanNodeIds(signal);
        String tod = NextSimInputScaffolder.buildDefaultSignalTod(signal, planNodes);
        assertTrue(tod.contains("plan id=\"1\""), "여러 plan 중 최소 id 를 골라야 함");
        assertFalse(tod.contains("plan id=\"2\""));
    }

    @Test
    void signal_tod_valid_when_signal_has_no_plans() {
        // signal.xml 이 빈 템플릿(플랜 보유 노드 없음)이면 TOD 도 비어야 정상
        Set<String> noPlans = NextSimInputScaffolder.extractSignalPlanNodeIds("<Signal id=\"0\">\n</Signal>");
        assertTrue(noPlans.isEmpty());
        assertTrue(NextSimInputScaffolder.signalTodValid("<TOD id=\"0\">\n</TOD>", noPlans));
        assertTrue(NextSimInputScaffolder.signalTodValid(null, noPlans), "검증 대상 자체가 없으면 항상 유효");
    }
}
