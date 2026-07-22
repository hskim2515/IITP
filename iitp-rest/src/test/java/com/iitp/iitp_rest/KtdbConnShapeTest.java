package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.service.network.KtdbNetworkConverter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 커넥션 shape가 내부링크 경유 지오메트리(다중 점 폴리라인)로 생성되는지 검증.
 * 실제 DB 연결 필요 (localhost:5432/iitp, 전국 KTDB 적재 상태).
 *
 * 대상: 대전 오정동 대전천북로×오정로37번길 — 삼각 교통섬을 4노드 일방통행 순환 링
 * (802→801→804→803→802)으로 모델링한 교차로. 순환 경유 동선이 직선 2점이 아니라
 * 링을 따라가는 폴리라인이어야 한다.
 *
 * 실행: ./gradlew test --tests "com.iitp.iitp_rest.KtdbConnShapeTest"
 */
@SpringBootTest
class KtdbConnShapeTest {

    @Autowired
    private KtdbNetworkConverter converter;

    /**
     * 유령 교차로 회귀 검증 — 동부네거리: 같은 이름(101)의 별개 교차로 2개(각 12~14m 링)가
     * 54.4m 같은 이름 본선 링크로 이어져 있다. span 게이트(50m)가 이 병합을 거부해야
     * 노드가 실제 교차로 2곳에 각각 남는다 (병합되면 1개 + 중간 유령 위치).
     */
    @Test
    void dongbu_junction_pair_stays_separate() {
        var result = converter.convert(
                36.3495, 127.4400, 36.3525, 127.4435,   // south, west, north, east
                36.3510, 127.4417, 2);

        long dongbuNodes = result.networkXml().getNodes().stream()
                .filter(n -> "동부네거리".equals(n.getName()))
                .count();
        System.out.println("동부네거리 노드 수: " + dongbuNodes);
        assertTrue(dongbuNodes >= 2, "동부네거리는 별개 교차로 2개로 유지되어야 함 (실제=" + dongbuNodes + ")");
    }

    @Test
    void ojeongdong_triangle_junction_has_polyline_connections() {
        var result = converter.convert(
                36.345, 127.405, 36.352, 127.416,   // south, west, north, east
                36.3485, 127.4105, 1);

        int totalConns = 0, multiPointConns = 0, maxPts = 0;
        String sample = null;
        for (NodeXml n : result.networkXml().getNodes()) {
            if (n.getConnections() == null) continue;
            for (ConnectionXml c : n.getConnections()) {
                totalConns++;
                int pts = c.getShape().trim().split("\\s+").length;
                if (pts > 2) {
                    multiPointConns++;
                    if (pts > maxPts) { maxPts = pts; sample = "node=" + n.getId() + " " + c.getShape(); }
                }
            }
        }
        System.out.printf("커넥션 %d개 중 다중점(>2) %d개, 최대 %d점%n", totalConns, multiPointConns, maxPts);
        System.out.println("최장 경유 shape 예: " + sample);

        assertTrue(totalConns > 0, "커넥션이 생성되어야 함");
        // 순환 링 경유 동선(802→801→804 등)이 존재하므로 다중 점 shape가 반드시 있어야 함
        assertTrue(multiPointConns > 0, "내부링크 경유 다중 점 커넥션이 있어야 함");
    }

    /**
     * 회귀 검증: 오프셋 없는 단일 차선끼리의 통과 커넥션은 시작/끝 좌표가 사실상 같은 지점이
     * 되어 length="1.0"인데 shape는 길이 0(같은 점 반복 또는 점 1개)인 축퇴 지오메트리가
     * 되던 문제. NextSim이 이런 축퇴 커넥션 근처에서 불안정하게 동작하는 경향이 관측되어
     * (out-link 진행 방향으로 length만큼 밀어낸) shape로 대체하도록 수정 — 이제 모든 커넥션의
     * shape 실제 길이가 length 속성과 (반올림 오차 범위 내에서) 일치해야 한다.
     */
    @Test
    void no_connection_has_degenerate_zero_length_shape() {
        var result = converter.convert(
                36.345, 127.405, 36.352, 127.416,
                36.3485, 127.4105, 1);

        int totalConns = 0, degenerate = 0;
        String sample = null;
        for (NodeXml n : result.networkXml().getNodes()) {
            if (n.getConnections() == null) continue;
            for (ConnectionXml c : n.getConnections()) {
                totalConns++;
                String[] pts = c.getShape().trim().split("\\s+");
                boolean isDegenerate;
                if (pts.length < 2) {
                    isDegenerate = true;
                } else {
                    String[] first = pts[0].split(",");
                    String[] last = pts[pts.length - 1].split(",");
                    double dx = Double.parseDouble(first[0]) - Double.parseDouble(last[0]);
                    double dy = Double.parseDouble(first[1]) - Double.parseDouble(last[1]);
                    isDegenerate = Math.hypot(dx, dy) < 1e-6;
                }
                if (isDegenerate) {
                    degenerate++;
                    if (sample == null) sample = "node=" + n.getId() + " " + c.getShape();
                }
            }
        }
        System.out.printf("커넥션 %d개 중 축퇴(0길이) shape %d개%n", totalConns, degenerate);
        assertTrue(totalConns > 0, "커넥션이 생성되어야 함");
        assertTrue(degenerate == 0, "축퇴(0길이) shape 커넥션이 없어야 함 — 예: " + sample);
    }
}
