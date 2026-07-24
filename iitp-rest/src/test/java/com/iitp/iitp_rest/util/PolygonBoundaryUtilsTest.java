package com.iitp.iitp_rest.util;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * KTDB 임포트 폴리곤/파일 경계 필터의 순수 로직 검증 — 사각형/오목다각형/여러 링 합집합.
 */
class PolygonBoundaryUtilsTest {

    @Test
    void insideSimpleSquare() {
        List<List<double[]>> rings = List.of(square(0, 0, 10, 10));
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(5, 5, rings)).isTrue();
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(20, 20, rings)).isFalse();
    }

    /** L자(오목) 다각형 — 오목한 안쪽(잘려나간 사분면)은 밖으로 판정돼야 한다. */
    @Test
    void concaveLShapeExcludesNotch() {
        List<double[]> lShape = List.of(
                new double[]{0, 0}, new double[]{10, 0}, new double[]{10, 5},
                new double[]{5, 5}, new double[]{5, 10}, new double[]{0, 10});
        List<List<double[]>> rings = List.of(lShape);

        assertThat(PolygonBoundaryUtils.isInsideAnyRing(2, 2, rings)).isTrue(); // 왼쪽 아래 — 내부
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(8, 8, rings)).isFalse(); // 잘려나간 오른쪽 위 — 외부(notch)
    }

    /** 서로 떨어진 두 사각형(파일 안 다각형 여러 개) — 합집합(둘 중 하나에라도 들어가면 포함). */
    @Test
    void unionOfMultipleRings() {
        List<List<double[]>> rings = List.of(square(0, 0, 5, 5), square(100, 100, 5, 5));
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(2, 2, rings)).isTrue();
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(102, 102, rings)).isTrue();
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(50, 50, rings)).isFalse();
    }

    @Test
    void nullRingsMeansNoFiltering() {
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(0, 0, null)).isTrue();
    }

    @Test
    void parsePolygonParamRoundTrip() {
        String json = "[[[0,0],[10,0],[10,10],[0,10]]]";
        List<List<double[]>> rings = PolygonBoundaryUtils.parsePolygonParam(json);
        assertThat(rings).hasSize(1);
        assertThat(rings.get(0)).hasSize(4);
        assertThat(PolygonBoundaryUtils.isInsideAnyRing(5, 5, rings)).isTrue();
    }

    @Test
    void parsePolygonParamHandlesBlankOrInvalid() {
        assertThat(PolygonBoundaryUtils.parsePolygonParam(null)).isEmpty();
        assertThat(PolygonBoundaryUtils.parsePolygonParam("")).isEmpty();
        assertThat(PolygonBoundaryUtils.parsePolygonParam("not json")).isEmpty();
        assertThat(PolygonBoundaryUtils.parsePolygonParam("[[[0,0],[1,1]]]")).isEmpty(); // 2점 — 유효한 링 아님
    }

    private static List<double[]> square(double x, double y, double w, double h) {
        return List.of(
                new double[]{x, y}, new double[]{x + w, y},
                new double[]{x + w, y + h}, new double[]{x, y + h});
    }
}
