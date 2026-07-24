package com.iitp.iitp_rest;

import com.iitp.iitp_rest.service.network.KtdbNetworkConverter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * KTDB 임포트 폴리곤/파일 경계 필터(KtdbNetworkConverter.convert(..., polygonRings)) 회귀 검증 —
 * 실제 DB 연결 필요(localhost:5432/iitp, 전국 KTDB 적재 상태, KtdbConnShapeTest와 동일 오정동 지역).
 *
 * 대상 bbox 전체가 아니라 서쪽 절반만 덮는 폴리곤을 줘서, 필터 적용 시 노드/링크 수가
 * bbox만 줬을 때보다 반드시 줄어드는지 확인한다(폴리곤 밖 도로가 실제로 제외되는지).
 *
 * 실행: ./gradlew test --tests "com.iitp.iitp_rest.KtdbPolygonBoundaryTest"
 */
@SpringBootTest
class KtdbPolygonBoundaryTest {

    @Autowired
    private KtdbNetworkConverter converter;

    private static final double SOUTH = 36.345, WEST = 127.405, NORTH = 36.352, EAST = 127.416;

    @Test
    void polygonNarrowerThanBboxExcludesSomeLinks() {
        var withoutPolygon = converter.convert(SOUTH, WEST, NORTH, EAST, 36.3485, 127.4105, 1);
        int fullLinkCount = withoutPolygon.networkXml().getLinks().size();

        // bbox 서쪽 절반만 덮는 사각 폴리곤
        double midLon = (WEST + EAST) / 2.0;
        List<List<double[]>> westHalf = List.of(List.of(
                new double[]{WEST, SOUTH}, new double[]{midLon, SOUTH},
                new double[]{midLon, NORTH}, new double[]{WEST, NORTH}));

        var withPolygon = converter.convert(SOUTH, WEST, NORTH, EAST, 36.3485, 127.4105, 1, westHalf);
        int filteredLinkCount = withPolygon.networkXml().getLinks().size();

        System.out.printf("bbox 전체 링크 %d개 → 서쪽 절반 폴리곤 적용 후 %d개%n", fullLinkCount, filteredLinkCount);
        assertTrue(filteredLinkCount < fullLinkCount,
                "폴리곤이 bbox보다 좁으므로 필터링된 링크 수가 더 적어야 함");
        assertTrue(filteredLinkCount > 0, "서쪽 절반에도 도로가 있어야 함(테스트 전제조건)");
    }
}
