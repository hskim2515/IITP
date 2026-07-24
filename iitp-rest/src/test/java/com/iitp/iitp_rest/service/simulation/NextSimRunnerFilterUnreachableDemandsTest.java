package com.iitp.iitp_rest.service.simulation;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * NextSimRunner 스테이징 시점의 방향성 기준 도달 불가능 OD 수요 제거(2차 방어) 검증 —
 * scenario1_2(11000174)/대전 오정동에서 gdb로 확정한 근본원인의 회귀 방지.
 */
class NextSimRunnerFilterUnreachableDemandsTest {

    private static void invoke(Path networkXml, Path odMatrixXml) throws Exception {
        Method m = NextSimRunner.class.getDeclaredMethod("filterUnreachableDemands", Path.class, Path.class);
        m.setAccessible(true);
        m.invoke(null, networkXml, odMatrixXml);
    }

    @Test
    void removesDemandWithNoDirectedPath(@TempDir Path tmp) throws Exception {
        // 1 -> 2 -> 3 (메인, 노드2에 link1→link2 회전 허용 커넥션 있음), 4 -> 5 (진입 간선 없는 고립 포켓)
        String network = """
                <Network>
                <node id="1" type="terminal"/>
                <node id="2" type="normal">
                    <connection id="0" from_link="1" to_link="2" turning="S"/>
                </node>
                <node id="3" type="terminal"/>
                <node id="4" type="terminal"/>
                <node id="5" type="terminal"/>
                <link id="1" from_node="1" to_node="2"/>
                <link id="2" from_node="2" to_node="3"/>
                <link id="3" from_node="4" to_node="5"/>
                </Network>
                """;
        String odmatrix = """
                <Demands><odMatrix id="0"><nvodMatrix>
                <demand source="1" sink="3" flow="10" dist=""/>
                <demand source="1" sink="5" flow="10" dist=""/>
                </nvodMatrix></odMatrix></Demands>
                """;
        Path networkXml = tmp.resolve("network.xml");
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(networkXml, network);
        Files.writeString(odMatrixXml, odmatrix);

        invoke(networkXml, odMatrixXml);

        String result = Files.readString(odMatrixXml);
        assertThat(result).contains("sink=\"3\"");
        assertThat(result).doesNotContain("sink=\"5\"");
    }

    @Test
    void keepsFileUntouchedWhenAllReachable(@TempDir Path tmp) throws Exception {
        String network = """
                <Network>
                <node id="1" type="terminal"/>
                <node id="2" type="normal">
                    <connection id="0" from_link="1" to_link="2" turning="S"/>
                </node>
                <node id="3" type="terminal"/>
                <link id="1" from_node="1" to_node="2"/>
                <link id="2" from_node="2" to_node="3"/>
                </Network>
                """;
        String odmatrix = """
                <Demands><odMatrix id="0"><nvodMatrix>
                <demand source="1" sink="3" flow="10" dist=""/>
                </nvodMatrix></odMatrix></Demands>
                """;
        Path networkXml = tmp.resolve("network.xml");
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(networkXml, network);
        Files.writeString(odMatrixXml, odmatrix);

        invoke(networkXml, odMatrixXml);

        assertThat(Files.readString(odMatrixXml)).isEqualTo(odmatrix);
    }

    /**
     * 실측(gdb, 대전 오정동 재임포트 11000357): 링크는 인접해 있어도(1→2→3 체인) 중간
     * 교차로(노드2)에 그 회전을 허용하는 커넥션이 없으면 실제로는 통행 불가능하다 —
     * route-generator가 Route.json을 빈 채로 남기고 nextsim이 크래시한다. 단순 링크
     * 인접성(방향성 포함)만으론 이 문제를 못 잡음이 확인됨.
     */
    @Test
    void removesDemandWhenLinksAdjacentButNoConnectionAtIntersection(@TempDir Path tmp) throws Exception {
        String network = """
                <Network>
                <node id="1" type="terminal"/>
                <node id="2" type="normal"/>
                <node id="3" type="terminal"/>
                <link id="1" from_node="1" to_node="2"/>
                <link id="2" from_node="2" to_node="3"/>
                </Network>
                """;
        String odmatrix = """
                <Demands><odMatrix id="0"><nvodMatrix>
                <demand source="1" sink="3" flow="10" dist=""/>
                </nvodMatrix></odMatrix></Demands>
                """;
        Path networkXml = tmp.resolve("network.xml");
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(networkXml, network);
        Files.writeString(odMatrixXml, odmatrix);

        invoke(networkXml, odMatrixXml);

        assertThat(Files.readString(odMatrixXml)).doesNotContain("sink=\"3\"");
    }

    /**
     * 실측(gdb, scenario1_2 최신 재임포트): 고립된 섬 안의 두 노드끼리는 서로 방향성
     * 경로가 있어도, 둘 다 메인 컴포넌트 밖이라 격리되며 type="garage" 로 전환된다 —
     * 이 경우도 순수 그래프 도달 가능성만으론 못 잡고 노드 타입까지 봐야 걸러진다.
     */
    @Test
    void removesDemandWhenSourceOrSinkIsGarageEvenIfReachable(@TempDir Path tmp) throws Exception {
        String network = """
                <Network>
                <node id="1" type="terminal"/>
                <node id="2" type="terminal"/>
                <node id="4" type="garage"/>
                <node id="5" type="garage"/>
                <link id="1" from_node="1" to_node="2"/>
                <link id="2" from_node="4" to_node="5"/>
                </Network>
                """;
        String odmatrix = """
                <Demands><odMatrix id="0"><nvodMatrix>
                <demand source="1" sink="2" flow="10" dist=""/>
                <demand source="4" sink="5" flow="10" dist=""/>
                </nvodMatrix></odMatrix></Demands>
                """;
        Path networkXml = tmp.resolve("network.xml");
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(networkXml, network);
        Files.writeString(odMatrixXml, odmatrix);

        invoke(networkXml, odMatrixXml);

        String result = Files.readString(odMatrixXml);
        assertThat(result).contains("sink=\"2\"");
        assertThat(result).doesNotContain("sink=\"5\"");
    }
}
