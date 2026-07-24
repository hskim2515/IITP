package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.section.SectionXml;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * KTDB 링크 종단경사(section) 계산 로직 검증 — DEM(ktdb.dem.path) 없이도 돌아가는 순수
 * 로직(구간 병합)과, DEM 미설정 시 안전하게 무동작하는지를 검증한다. 실제 gdallocationinfo
 * 배치 조회는 개발서버(DEM 파일 존재)에서만 검증 가능 — 여기서는 미포함.
 */
class TerrainSlopeServiceTest {

    private static TerrainSlopeService newService(String demPath) throws Exception {
        return newService(demPath, 0); // 기본: 스무딩 없음 — 기존 병합 로직만 단독 검증
    }

    private static TerrainSlopeService newService(String demPath, int smoothingWindowSamples) throws Exception {
        TerrainSlopeService svc = new TerrainSlopeService();
        setField(svc, "demPath", demPath);
        setField(svc, "sampleIntervalM", 10.0);
        setField(svc, "slopeMergeThreshold", 1.5);
        setField(svc, "smoothingWindowSamples", smoothingWindowSamples);
        return svc;
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field f = TerrainSlopeService.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(target, value);
    }

    @Test
    void isConfiguredFalseWhenPathBlank() throws Exception {
        assertThat(newService("").isConfigured()).isFalse();
        assertThat(newService(null).isConfigured()).isFalse();
    }

    @Test
    void isConfiguredTrueWhenPathSet() throws Exception {
        assertThat(newService("/some/dem.tif").isConfigured()).isTrue();
    }

    @Test
    void computeSectionsReturnsEmptyWhenDemNotConfigured() throws Exception {
        TerrainSlopeService svc = newService("");
        Map<Long, List<Map<String, Double>>> coords = Map.of(
                1L, List.of(Map.of("lat", 37.5, "lng", 126.7), Map.of("lat", 37.51, "lng", 126.71)));
        Map<Long, Double> lengths = Map.of(1L, 100.0);

        assertThat(svc.computeSections(coords, lengths)).isEmpty();
    }

    /** 경사가 쭉 일정하면 section 하나로 합쳐져야 한다(부천 예시의 단일 section 링크와 같은 성격). */
    @Test
    void uniformSlopeMergesIntoSingleSection() throws Exception {
        TerrainSlopeService svc = newService("/some/dem.tif");
        // offset 0~100m, 매 10m마다 1m씩 균일하게 상승 = 10% 경사 일정
        List<double[]> offsetElev = new java.util.ArrayList<>();
        for (int i = 0; i <= 10; i++) offsetElev.add(new double[]{i * 10.0, i * 1.0});

        List<SectionXml> sections = svc.mergeIntoSections(offsetElev);

        assertThat(sections).hasSize(1);
        assertThat(sections.get(0).getOffset()).isEqualTo(0.0);
        assertThat(sections.get(0).getLength()).isEqualTo(100.0);
        assertThat(sections.get(0).getSlope()).isEqualTo(10.0);
        assertThat(sections.get(0).getLeftId()).isEqualTo("None");
        assertThat(sections.get(0).getRightId()).isEqualTo("None");
    }

    /** 경사가 중간에 바뀌면 여러 section으로 나뉘고, length 합이 전체 길이와 일치해야 한다. */
    @Test
    void slopeChangeSplitsIntoMultipleSectionsSummingToTotalLength() throws Exception {
        TerrainSlopeService svc = newService("/some/dem.tif");
        List<double[]> offsetElev = new java.util.ArrayList<>();
        // 0~50m: 완만한 상승(1%), 50~100m: 급격한 상승(10%) — 확실히 구분되는 두 구간
        for (int i = 0; i <= 5; i++) offsetElev.add(new double[]{i * 10.0, i * 0.1});
        for (int i = 1; i <= 5; i++) offsetElev.add(new double[]{50.0 + i * 10.0, 0.5 + i * 1.0});

        List<SectionXml> sections = svc.mergeIntoSections(offsetElev);

        assertThat(sections.size()).isGreaterThanOrEqualTo(2);
        double totalLength = sections.stream().mapToDouble(SectionXml::getLength).sum();
        assertThat(totalLength).isCloseTo(100.0, org.assertj.core.data.Offset.offset(0.01));
        // 체인 검증: 처음/끝은 None, 나머지는 연속된 id 참조
        assertThat(sections.get(0).getLeftId()).isEqualTo("None");
        assertThat(sections.get(sections.size() - 1).getRightId()).isEqualTo("None");
        for (int i = 0; i < sections.size() - 1; i++) {
            assertThat(sections.get(i).getRightId()).isEqualTo(String.valueOf(i + 1));
            assertThat(sections.get(i + 1).getLeftId()).isEqualTo(String.valueOf(i));
        }
    }

    /**
     * 실측(부천 실제 링크, 1m DEM): 스무딩 없이는 연석/가로수 등 표면 잡음으로 단일 샘플
     * 구간에서 ±50~65% 같은 비현실적 경사 스파이크가 남았다 — 이동평균 스무딩을 켜면
     * 그 스파이크가 주변 완만한 경사에 흡수돼 사라져야 한다(전체는 여전히 대체로 평평).
     */
    @Test
    void smoothingSuppressesSingleSampleNoiseSpike() throws Exception {
        TerrainSlopeService svc = newService("/some/dem.tif", 5);
        List<double[]> offsetElev = new java.util.ArrayList<>();
        // 0~200m: 거의 평평(0.1%)한데, 딱 한 지점(100m)에서 1m 위로 튀는 잡음(연석 등 흉내)
        for (int i = 0; i <= 20; i++) {
            double elev = i * 10.0 * 0.001; // 완만한 0.1% 경사
            if (i == 10) elev += 1.0; // 단일 샘플 스파이크
            offsetElev.add(new double[]{i * 10.0, elev});
        }

        List<SectionXml> sections = svc.mergeIntoSections(offsetElev);

        // 스무딩 덕분에 스파이크가 흡수돼 전 구간 경사가 완만한 범위 안에 있어야 함(비현실적 급경사 없음)
        assertThat(sections).allSatisfy(s -> assertThat(Math.abs(s.getSlope())).isLessThan(10.0));
        double totalLength = sections.stream().mapToDouble(SectionXml::getLength).sum();
        assertThat(totalLength).isCloseTo(200.0, org.assertj.core.data.Offset.offset(0.01));
    }

    /** 스무딩 윈도우가 1 이하면 비활성 — 기존(스무딩 없음) 동작과 동일해야 한다. */
    @Test
    void smoothingDisabledWhenWindowIsOneOrLess() throws Exception {
        TerrainSlopeService svcNoSmooth = newService("/some/dem.tif", 0);
        List<double[]> offsetElev = new java.util.ArrayList<>();
        for (int i = 0; i <= 10; i++) offsetElev.add(new double[]{i * 10.0, i * 1.0});

        List<SectionXml> sections = svcNoSmooth.mergeIntoSections(offsetElev);

        assertThat(sections).hasSize(1);
        assertThat(sections.get(0).getSlope()).isEqualTo(10.0);
    }
}
