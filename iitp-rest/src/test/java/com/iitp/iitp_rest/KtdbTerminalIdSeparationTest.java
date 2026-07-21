package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.service.network.KtdbNetworkConverter;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * route-generator std::out_of_range(_Map_base::at) 크래시 회귀 검증 —
 * 터미널 노드가 일반/교차로 노드와 같은 id 공간을 공유하면(둘 다 10000001부터 순차 할당)
 * NextSim route-generator 내부 배열 인덱싱이 범위를 벗어나 크래시함을 gdb 로 확인
 * (KAIST 배포판 bucheon/toy grid 예시는 terminal=11xxxxxx, 그 외=10xxxxxx 로 분리돼
 * 우연히 이 버그를 피해감). 변환기가 이 분리 규약을 실제로 지키는지 검증.
 *
 * 대상 bbox: 대전 오정동(scaffold_test 원본 크래시 재현 지역, 법2동행정복지센터·최소노드배치점
 * 등 실제 크래시 유발 터미널 노드 포함) — 실제 DB 연결 필요(localhost:5432/iitp, 전국 KTDB 적재 상태).
 *
 * 실행: ./gradlew test --tests "com.iitp.iitp_rest.KtdbTerminalIdSeparationTest"
 */
@SpringBootTest
class KtdbTerminalIdSeparationTest {

    @Autowired
    private KtdbNetworkConverter converter;

    @Autowired
    private NetworkJaxbParser jaxbParser;

    @Test
    void terminal_and_nonterminal_nodes_use_disjoint_id_ranges() throws Exception {
        var result = converter.convert(
                36.345, 127.405, 36.352, 127.416,   // south, west, north, east (오정동, scaffold_test 원본과 동일)
                36.3485, 127.4105, 1);

        int terminalCount = 0, nonTerminalCount = 0;
        for (NodeXml n : result.networkXml().getNodes()) {
            long id = n.getId();
            if (n.getType() == NodeType.Terminal) {
                terminalCount++;
                assertTrue(id >= 11000001L && id < 12000000L,
                        "터미널 노드 id는 11000001~ 대역이어야 함 (실제: " + id + ", name=" + n.getName() + ")");
            } else {
                nonTerminalCount++;
                assertTrue(id >= 10000001L && id < 11000000L,
                        "비터미널 노드 id는 10000001~10999999 대역이어야 함 (실제: " + id
                                + ", type=" + n.getType() + ", name=" + n.getName() + ")");
            }
        }
        System.out.printf("터미널 %d개, 비터미널 %d개 — id 대역 분리 검증 통과%n", terminalCount, nonTerminalCount);
        assertTrue(terminalCount > 0, "이 bbox는 터미널 노드를 포함해야 함(회귀 검증 전제조건)");

        // route-generator 실제 실행 검증용 — docker 하네스가 읽을 network.xml 을 스크래치패드에 저장
        byte[] xmlBytes = jaxbParser.marshal(result.networkXml());
        Path out = Path.of("/private/tmp/claude-501/-Users-hskim-Documents-repo-iitp/50035ff7-8d8f-49c6-a246-49bd9dc1a3d3/scratchpad/postfix_ojeongdong/network.xml");
        Files.createDirectories(out.getParent());
        Files.write(out, xmlBytes, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        System.out.println("network.xml 저장: " + out);

        // 알려진 크래시 유발 터미널 이름 → 새로 부여된 id 확인 (odmatrix 재구성용)
        for (NodeXml n : result.networkXml().getNodes()) {
            if ("법2동행정복지센터".equals(n.getName()) || "최소노드배치점".equals(n.getName())) {
                System.out.println("원인 터미널 " + n.getName() + " → 새 id=" + n.getId() + " type=" + n.getType());
            }
        }
    }
}
