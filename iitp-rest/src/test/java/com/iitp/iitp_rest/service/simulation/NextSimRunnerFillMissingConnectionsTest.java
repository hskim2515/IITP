package com.iitp.iitp_rest.service.simulation;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * fillMissingConnections/connXml 이 커넥션 누락을 보완할 때 shape 두 점을 노드 center 로
 * 동일하게 채워 length="1.0" 과 불일치하는 축퇴(0길이) 지오메트리를 만들던 문제
 * (KtdbNetworkConverter/SumoNetConverter 에서 실측된 것과 동일 문제)의 회귀 테스트.
 */
class NextSimRunnerFillMissingConnectionsTest {

    private static String invoke(String block) throws Exception {
        Method m = NextSimRunner.class.getDeclaredMethod("fillMissingConnections", String.class);
        m.setAccessible(true);
        return (String) m.invoke(null, block);
    }

    @Test
    void injectedConnectionShapeIsNotDegenerate() throws Exception {
        String block = "<node id=\"1\" type=\"normal\" num_port=\"2\" num_connection=\"0\" center=\"10.0 20.0\">"
                + "<port type=\"in\" link_id=\"100\"/>"
                + "<port type=\"out\" link_id=\"200\"/>"
                + "</node>";

        String result = invoke(block);

        assertThat(result).contains("<connection");
        String shapeAttr = result.replaceAll(".*shape=\"([^\"]+)\".*", "$1");
        String[] pts = shapeAttr.trim().split("\\s+");
        assertThat(pts).hasSize(2);
        String[] p0 = pts[0].split(",");
        String[] p1 = pts[1].split(",");
        double dx = Double.parseDouble(p0[0]) - Double.parseDouble(p1[0]);
        double dy = Double.parseDouble(p0[1]) - Double.parseDouble(p1[1]);
        assertThat(Math.hypot(dx, dy)).isGreaterThan(1e-6);
    }

    @Test
    void blockWithoutMissingConnectionsIsUnchanged() throws Exception {
        String block = "<node id=\"1\" type=\"normal\" num_port=\"2\" num_connection=\"1\" center=\"10.0 20.0\">"
                + "<port type=\"in\" link_id=\"100\"/>"
                + "<port type=\"out\" link_id=\"200\"/>"
                + "<connection id=\"0\" from_link=\"100\" from_lane=\"0\" to_link=\"200\" to_lane=\"0\" "
                + "turning=\"S\" length=\"46.0\" width=\"3.5\" ff_spd=\"40.0\" shape=\"10.0,20.0 12.0,22.0\"/>"
                + "</node>";

        assertThat(invoke(block)).isEqualTo(block);
    }
}
