package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.segment.SegmentXml;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 프론트 lane 병합(concatLaneDerived 등, 통과 노드 삭제 시 lane 이어붙이기)이 만드는
 * &lt;segment&gt;가 NextSim이 요구하는 필수 속성을 갖추고 마샬링되는지 검증 —
 * 실측(gdb, scenario3_1/부천): NextSimIO::ArcArr::ArcArr()에서 strcmp(NULL, "True")로
 * SIGSEGV — segment의 block 속성이 한 번도 세팅된 적 없어(JAXB가 null Boolean 속성을
 * 생략) 발생. init_point/end_point(스네이크 케이스) 불일치는 nextsim(시뮬 엔진)이
 * "Element should have 'init_point' attribute" 예외로 즉시 거부함도 실측 확인.
 * 원격 서버(gaia3d 개발서버)에서 실제 route-generator/nextsim 배포판 바이너리로 이
 * 두 크래시가 이 수정으로 사라짐을 직접 재현·검증함.
 */
class SegmentXmlMarshalTest {

    @Test
    void segmentMarshalsWithRequiredNextSimAttributes() throws Exception {
        SegmentXml segment = new SegmentXml();
        segment.setId(0L);
        segment.setInitPoint(0.0);
        segment.setEndPoint(50.71);
        // block/rightLc/leftLc 는 의도적으로 세팅하지 않음 — 프론트가 값을 안 보내는
        // 실제 상황(concatLaneDerived 등)을 재현. 클래스 필드 기본값으로 채워져야 한다.

        LaneXml lane = new LaneXml();
        lane.setId(0L);
        lane.setSegments(List.of(segment));

        LinkXml link = new LinkXml();
        link.setId(20000001L);
        link.setFromNode(10000001L);
        link.setToNode(10000002L);
        link.setLanes(List.of(lane));

        NodeXml from = new NodeXml();
        from.setId(10000001L);
        from.setType(NodeType.Terminal);
        NodeXml to = new NodeXml();
        to.setId(10000002L);
        to.setType(NodeType.Terminal);

        NetworkXml network = new NetworkXml();
        network.setNodes(List.of(from, to));
        network.setLinks(List.of(link));

        NetworkJaxbParser parser = new NetworkJaxbParser();
        String xml = new String(parser.marshal(network), StandardCharsets.UTF_8);

        assertThat(xml).contains("block=\"false\"");
        assertThat(xml).contains("init_point=\"0.0\"");
        assertThat(xml).contains("end_point=\"50.71\"");
        assertThat(xml).contains("right_lc=\"\"");
        assertThat(xml).contains("left_lc=\"\"");
        // 예전 camelCase 이름으로는 더 이상 안 나가야 함(nextsim이 이 이름을 거부하고 크래시했음)
        assertThat(xml).doesNotContain("initPoint=");
        assertThat(xml).doesNotContain("endPoint=");
    }
}
