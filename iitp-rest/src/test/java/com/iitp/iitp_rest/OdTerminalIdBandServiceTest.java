package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.port.PortType;
import com.iitp.iitp_rest.model.network.port.PortXml;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.service.odmatrix.OdMatrixService;
import com.iitp.iitp_rest.service.odmatrix.OdTerminalIdBandService;
import com.iitp.iitp_rest.util.FileStorageService;
import jakarta.xml.bind.JAXBContext;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * OD 저장 시점 터미널/일반 노드 id 대역 보정 검증 — route-generator std::out_of_range
 * 크래시(터미널·일반 노드가 같은 id 공간 공유) 회귀 방지가 수동그리기 네트워크에도
 * 적용되는지. "이번에 추가/제거되는 노드만" 건드리고 나머지는 절대 안 바뀌어야 한다.
 */
class OdTerminalIdBandServiceTest {

    // 노드 구성: 5000001(degree=1, 아직 미배정 대역) — 신규 OD 추가 대상
    //           11000005(degree=1, 이미 올바른 대역) — 그대로 유지돼야 함
    //           7000002(degree=2, 원래 sink였는데 도로가 이어져 통과노드로 바뀐 경우) — 제거 시 10M 대역으로
    //           10000009(degree=2, 안 건드릴 노드) — touched 집합 밖, 절대 안 바뀜
    private static final String NETWORK_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <Network id="0" base_lat="36.0" base_lon="127.0">
              <nodes>
                <node id="5000001" type="normal" num_port="1" num_connection="0">
                  <port type="out" link_id="20000001"/>
                </node>
                <node id="11000005" type="terminal" num_port="1" num_connection="0">
                  <port type="in" link_id="20000002"/>
                </node>
                <node id="7000002" type="normal" num_port="2" num_connection="1">
                  <port type="in" link_id="20000003"/>
                  <port type="out" link_id="20000004"/>
                </node>
                <node id="10000009" type="normal" num_port="2" num_connection="1">
                  <port type="in" link_id="20000005"/>
                  <port type="out" link_id="20000006"/>
                </node>
              </nodes>
              <links>
                <link id="20000001" from_node="5000001" to_node="7000002" num_lane="1" length="10" width="3.5" max_spd="30" min_spd="0" ff_spd="30" wave_spd="5" qmax="1800" max_veh="1" sim_type="0" type="straight" stop_line="0"/>
                <link id="20000003" from_node="10000009" to_node="7000002" num_lane="1" length="10" width="3.5" max_spd="30" min_spd="0" ff_spd="30" wave_spd="5" qmax="1800" max_veh="1" sim_type="0" type="straight" stop_line="0"/>
                <link id="20000004" from_node="7000002" to_node="11000005" num_lane="1" length="10" width="3.5" max_spd="30" min_spd="0" ff_spd="30" wave_spd="5" qmax="1800" max_veh="1" sim_type="0" type="straight" stop_line="0"/>
              </links>
            </Network>
            """;

    private OdMatrixXml od(String... sourceSinkPairs) {
        OdMatrixXml od = new OdMatrixXml();
        OdMatrixXml.OdMatrixItemXml item = new OdMatrixXml.OdMatrixItemXml();
        OdMatrixXml.NvOdMatrixXml nvod = new OdMatrixXml.NvOdMatrixXml();
        java.util.List<OdMatrixXml.DemandXml> demands = new java.util.ArrayList<>();
        for (int i = 0; i + 1 < sourceSinkPairs.length; i += 2) {
            OdMatrixXml.DemandXml d = new OdMatrixXml.DemandXml();
            d.setSource(sourceSinkPairs[i]);
            d.setSink(sourceSinkPairs[i + 1]);
            d.setFlow(10.0);
            demands.add(d);
        }
        nvod.setDemands(demands);
        item.setNvodMatrix(nvod);
        od.setOdMatrices(List.of(item));
        return od;
    }

    private FileStorageService mockStorage(ByteArrayOutputStream capturedUpload) throws Exception {
        FileStorageService storage = mock(FileStorageService.class);
        when(storage.readFile("v1/network.xml")).thenReturn(NETWORK_XML.getBytes(StandardCharsets.UTF_8));
        doAnswer(inv -> {
            InputStream is = inv.getArgument(0);
            is.transferTo(capturedUpload);
            return null;
        }).when(storage).uploadFile(any(InputStream.class), eq("v1"), eq("network.xml"));
        return storage;
    }

    @Test
    void newly_added_terminal_candidate_gets_rebanded() throws Exception {
        ByteArrayOutputStream uploaded = new ByteArrayOutputStream();
        FileStorageService storage = mockStorage(uploaded);
        OdTerminalIdBandService svc = new OdTerminalIdBandService(storage, new NetworkJaxbParser(), mock(OdMatrixService.class));

        OdMatrixXml oldOd = od(); // 빈 OD
        OdMatrixXml newOd = od("5000001", "11000005"); // 5000001 신규 추가(degree=1, 미배정 대역)

        Map<String, String> remap = svc.reconcileTerminalIds("v1", oldOd, newOd);

        assertEquals(1, remap.size(), "5000001 하나만 재배정 대상(11000005는 이미 올바른 대역)");
        assertTrue(remap.containsKey("5000001"));
        long newId = Long.parseLong(remap.get("5000001"));
        assertTrue(newId >= 11_000_001L && newId < 12_000_000L, "터미널 대역으로 재배정돼야 함: " + newId);

        svc.applyRemapToOdMatrix(newOd, remap);
        assertEquals(remap.get("5000001"), newOd.getOdMatrices().get(0).getNvodMatrix().getDemands().get(0).getSource());

        verify(storage).uploadFile(any(), eq("v1"), eq("network.xml"));
        assertTrue(uploaded.size() > 0);
    }

    /**
     * Network ID naming 스펙: Terminal은 연결된 단 하나의 Link와 뒷자리 3자리가 동일해야
     * 한다(NetworkIdAssigner.terminalIdFor와 동일 규칙 — 임포트 변환기·NetworkIdNormalizer는
     * 전부 이 규칙으로 신규 터미널을 만드는데, 재배정 경로만 순번 배정이라 규칙을 어기고
     * 있었음. 이 테스트는 그 회귀 방지용).
     */
    @Test
    void rebanded_terminal_matches_paired_link_suffix() throws Exception {
        ByteArrayOutputStream uploaded = new ByteArrayOutputStream();
        FileStorageService storage = mockStorage(uploaded);
        OdTerminalIdBandService svc = new OdTerminalIdBandService(storage, new NetworkJaxbParser(), mock(OdMatrixService.class));

        // 5000001의 유일한 연결 링크는 20000001 — 뒷자리 3자리 "001"
        OdMatrixXml oldOd = od();
        OdMatrixXml newOd = od("5000001", "11000005");

        Map<String, String> remap = svc.reconcileTerminalIds("v1", oldOd, newOd);

        assertEquals("11000001", remap.get("5000001"),
                "Terminal 뒷자리 3자리가 연결된 Link(20000001)의 뒷자리 3자리와 동일해야 함");
    }

    @Test
    void already_banded_node_is_never_touched() throws Exception {
        ByteArrayOutputStream uploaded = new ByteArrayOutputStream();
        FileStorageService storage = mockStorage(uploaded);
        OdTerminalIdBandService svc = new OdTerminalIdBandService(storage, new NetworkJaxbParser(), mock(OdMatrixService.class));

        OdMatrixXml oldOd = od();
        OdMatrixXml newOd = od("11000005", "11000005"); // 이미 올바른 대역인 노드만 추가

        Map<String, String> remap = svc.reconcileTerminalIds("v1", oldOd, newOd);

        assertTrue(remap.isEmpty(), "이미 대역이 맞으면 재배정 없음");
        verify(storage, never()).uploadFile(any(), any(), any());
    }

    @Test
    void unrelated_existing_node_ids_are_never_modified() throws Exception {
        ByteArrayOutputStream uploaded = new ByteArrayOutputStream();
        FileStorageService storage = mockStorage(uploaded);
        OdTerminalIdBandService svc = new OdTerminalIdBandService(storage, new NetworkJaxbParser(), mock(OdMatrixService.class));

        // 10000009는 어느 쪽 OD에도 등장하지 않음 — touched 집합 밖
        OdMatrixXml oldOd = od();
        OdMatrixXml newOd = od("5000001", "11000005");

        Map<String, String> remap = svc.reconcileTerminalIds("v1", oldOd, newOd);

        assertFalse(remap.containsKey("10000009"), "OD 에 등장하지 않는 노드는 재배정 대상이 아니어야 함");
        assertFalse(remap.containsKey("11000005"), "이미 참조 중이고 대역도 맞는 노드는 안 건드림");
    }

    @Test
    void node_removed_from_od_with_changed_degree_is_rebanded_back() throws Exception {
        ByteArrayOutputStream uploaded = new ByteArrayOutputStream();
        FileStorageService storage = mockStorage(uploaded);
        OdTerminalIdBandService svc = new OdTerminalIdBandService(storage, new NetworkJaxbParser(), mock(OdMatrixService.class));

        // 7000002 는 network.xml 상 이미 degree=2(통과노드로 바뀐 상태) — 예전엔 터미널로
        // 참조되고 있었지만(oldOd) 이번엔 OD 에서 빠짐(newOd) → 현재 degree(>1)에 맞게
        // 10M 대역으로 재배정돼야 함(제거 시에도 현재 상태를 재검증).
        OdMatrixXml oldOd = od("5000001", "7000002");
        OdMatrixXml newOd = od("5000001", "11000005"); // 7000002 제거됨

        Map<String, String> remap = svc.reconcileTerminalIds("v1", oldOd, newOd);

        assertEquals(1, remap.size(), "5000001 은 oldOd/newOd 양쪽에 다 있어 touched(대칭차) 밖 — 7000002 만 대상");
        assertTrue(remap.containsKey("7000002"), "제거되면서 degree 도 안 맞는 노드는 재배정 대상");
        long newId = Long.parseLong(remap.get("7000002"));
        assertTrue(newId >= 10_000_001L && newId < 11_000_000L, "일반 대역으로 재배정돼야 함(degree=2): " + newId);
    }

    @Test
    void no_touched_nodes_means_no_network_xml_write() throws Exception {
        ByteArrayOutputStream uploaded = new ByteArrayOutputStream();
        FileStorageService storage = mockStorage(uploaded);
        OdTerminalIdBandService svc = new OdTerminalIdBandService(storage, new NetworkJaxbParser(), mock(OdMatrixService.class));

        OdMatrixXml oldOd = od("11000005", "11000005");
        OdMatrixXml newOd = od("11000005", "11000005"); // 완전히 동일 — 변경 없음

        Map<String, String> remap = svc.reconcileTerminalIds("v1", oldOd, newOd);

        assertTrue(remap.isEmpty());
        verify(storage, never()).readFile(any());
    }

    // ── reconcileAfterNetworkEdit — 네트워크 편집(diff 저장) 트리거 ─────────────────────

    private NetworkXml parsedNetwork() {
        return new NetworkJaxbParser().parse(new ByteArrayInputStream(NETWORK_XML.getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * OD가 이미 참조 중인 노드(11000005, network.xml상 degree=1로 대역이 이미 맞음)와 달리,
     * 네트워크 편집으로 degree가 드리프트된 채 OD가 참조 중인 노드(7000002, degree=2인데
     * OD에는 터미널처럼 참조되고 있었다고 가정)는 대역을 다시 맞춰야 한다.
     */
    @Test
    void reconcileAfterNetworkEdit_rebandsOdReferencedNodeWithDriftedDegree() throws Exception {
        OdMatrixService odMatrixService = mock(OdMatrixService.class);
        // 편집 전 이미 OD가 "7000002"를 source로 참조 중이었다고 가정(당시엔 degree=1이었을 것) —
        // 이번 네트워크 편집으로 network.xml상 degree가 2로 바뀐 상태(NETWORK_XML 고정값)를 재현.
        when(odMatrixService.getByVersionId("v1")).thenReturn(od("7000002", "11000005"));

        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), odMatrixService);

        NetworkXml network = parsedNetwork();
        Map<String, String> remap = svc.reconcileAfterNetworkEdit("v1", network);

        assertEquals(1, remap.size(), "이미 대역이 맞는 11000005는 대상 아님 — 7000002만");
        assertTrue(remap.containsKey("7000002"));
        long newId = Long.parseLong(remap.get("7000002"));
        assertTrue(newId >= 10_000_001L && newId < 11_000_000L, "degree=2이므로 일반 대역: " + newId);

        // network 객체 자체가 in-place로 갱신됐는지(호출부가 이걸 그대로 marshal/upload 함)
        boolean idUpdated = network.getNodes().stream().anyMatch(n -> n.getId() == newId);
        assertTrue(idUpdated, "network.xml 객체에 새 id가 반영돼야 함");
        boolean oldIdGone = network.getNodes().stream().noneMatch(n -> n.getId() == 7000002L);
        assertTrue(oldIdGone);
    }

    /** OD가 전혀 참조하지 않는 노드는 degree가 얼마든 이 메서드의 대상이 아니다. */
    @Test
    void reconcileAfterNetworkEdit_ignoresNonOdReferencedNodes() throws Exception {
        OdMatrixService odMatrixService = mock(OdMatrixService.class);
        when(odMatrixService.getByVersionId("v1")).thenReturn(od("11000005", "11000005")); // 7000002는 OD 밖

        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), odMatrixService);

        Map<String, String> remap = svc.reconcileAfterNetworkEdit("v1", parsedNetwork());

        assertTrue(remap.isEmpty(), "OD 미참조 노드는 degree 드리프트가 있어도 안 건드림");
    }

    /** OD 자체가 없는(아직 안 만든) 버전은 조용히 빈 결과 — 네트워크 저장을 막으면 안 됨. */
    @Test
    void reconcileAfterNetworkEdit_noOdData_returnsEmpty() throws Exception {
        OdMatrixService odMatrixService = mock(OdMatrixService.class);
        when(odMatrixService.getByVersionId("v1")).thenThrow(new java.io.FileNotFoundException("no od"));

        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), odMatrixService);

        Map<String, String> remap = svc.reconcileAfterNetworkEdit("v1", parsedNetwork());

        assertTrue(remap.isEmpty());
    }

    // ── pruneDanglingReferences — 네트워크 편집으로 노드가 완전히 삭제된 경우 ──────────────

    @Test
    void pruneDanglingReferences_removesDemandsReferencingDeletedNode() {
        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), mock(OdMatrixService.class));

        // network.xml에는 5000001/11000005/7000002/10000009만 존재 — "99999999"는 이번 편집으로
        // 삭제됐다고 가정(더 이상 network의 어느 노드에도 없음).
        OdMatrixXml odData = od("5000001", "99999999", "10000009", "11000005");
        int removed = svc.pruneDanglingReferences(parsedNetwork(), odData);

        assertEquals(1, removed, "삭제된 노드를 참조하는 demand 1건만 제거돼야 함");
        var demands = odData.getOdMatrices().get(0).getNvodMatrix().getDemands();
        assertEquals(1, demands.size());
        assertEquals("10000009", demands.get(0).getSource());
        assertEquals("11000005", demands.get(0).getSink());
    }

    @Test
    void pruneDanglingReferences_keepsDemandsWhenBothEndsExist() {
        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), mock(OdMatrixService.class));

        OdMatrixXml odData = od("5000001", "11000005", "10000009", "7000002");
        int removed = svc.pruneDanglingReferences(parsedNetwork(), odData);

        assertEquals(0, removed);
        assertEquals(2, odData.getOdMatrices().get(0).getNvodMatrix().getDemands().size());
    }

    @Test
    void pruneDanglingReferences_noOdData_returnsZero() {
        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), mock(OdMatrixService.class));

        assertEquals(0, svc.pruneDanglingReferences(parsedNetwork(), null));
        assertEquals(0, svc.pruneDanglingReferences(parsedNetwork(), new OdMatrixXml()));
    }

    // ── 대규모 스트레스 — OD가 참조하는 수백 개 노드가 한 번에 재배정 대상이 되는 경우 ──

    /**
     * 실측 재현: OD가 참조 중인 노드 300개가 전부 "일반 대역(10xxxxxx)인데 실제 degree는
     * 1(터미널이어야 함)"로 드리프트된 상태를 한 번에 재배정한다 — 뒷자리 3자리 슬롯(1000개)
     * 대비 300개면 충돌 빈도는 낮지만, 페어링 링크 id를 일부러 반복시켜(마지막 3자리를
     * 겹치게) 충돌 폴백이 실제로 여러 번 발동하도록 만든다. 이 규모에서도 최종적으로
     * 전부 유일하고 올바른 대역(11xxxxxx)에 있어야 한다.
     */
    @Test
    void reconcileAfterNetworkEdit_largeScale_manyDriftedNodesHeavyCollisions_allUniqueAndBanded() throws Exception {
        NetworkXml network = new NetworkXml();
        List<NodeXml> nodes = new ArrayList<>();
        Set<String> odIds = new HashSet<>();

        final int count = 300;
        for (int i = 0; i < count; i++) {
            long nodeId = 10_010_000L + i; // 일반 대역이지만 아래서 degree=1로 만듦(드리프트 재현)
            NodeXml n = new NodeXml();
            n.setId(nodeId);
            PortXml p = new PortXml();
            p.setType(PortType.out);
            // 일부러 뒷자리 3자리를 (i % 50)로 자주 겹치게 만들어 충돌 폴백을 대량 유발
            long pairedLinkId = 20_000_000L + (i % 50);
            p.setLinkId(String.valueOf(pairedLinkId));
            n.setPorts(List.of(p)); // degree=1 → shouldBeTerminalBand=true 인데 현재 10M대역 — 재배정 대상
            nodes.add(n);
            odIds.add(String.valueOf(nodeId));
        }
        network.setNodes(nodes);
        network.setLinks(List.of());

        OdMatrixService odMatrixService = mock(OdMatrixService.class);
        when(odMatrixService.getByVersionId("v1")).thenReturn(od(odIds.toArray(new String[0])));
        OdTerminalIdBandService svc = new OdTerminalIdBandService(
                mock(FileStorageService.class), new NetworkJaxbParser(), odMatrixService);

        Map<String, String> remap = assertDoesNotThrow(() -> svc.reconcileAfterNetworkEdit("v1", network));

        assertEquals(count, remap.size(), "드리프트된 노드 전부 재배정 대상");

        Set<String> newIds = new HashSet<>(remap.values());
        assertEquals(count, newIds.size(), "재배정된 id가 전부 유일해야 함 — 중복은 NextSim 크래시 유발");
        for (String idStr : newIds) {
            long id = Long.parseLong(idStr);
            assertTrue(id >= 11_000_000L && id < 12_000_000L, "터미널 대역이어야 함: " + id);
        }

        // network 객체 자체에도 새 id가 일관되게 반영됐는지
        Set<Long> finalNodeIds = new HashSet<>();
        for (NodeXml n : network.getNodes()) assertTrue(finalNodeIds.add(n.getId()), "network 내 중복 id: " + n.getId());
    }
}
