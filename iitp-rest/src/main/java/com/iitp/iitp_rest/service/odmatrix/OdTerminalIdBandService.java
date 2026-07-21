package com.iitp.iitp_rest.service.odmatrix;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * NextSim route-generator 크래시 회귀 방지 — 터미널(degree≤1) 노드와 일반(degree&gt;1)
 * 노드가 같은 id 공간을 공유하면 route-generator 가 std::out_of_range 로 크래시함
 * (gdb 로 확인, {@code KtdbNetworkConverter}/{@code KtdbStreamingConverter} 에 동일 원리로
 * 이미 적용됨 — 거긴 변환 시점에 전체를 한 번에 안다는 전제가 성립해서 안전했음).
 *
 * <p>수동으로 그린 네트워크는 편집이 점진적이라 "생성 시점에 한 번에" 배정이 불가능하다.
 * 대신 실제로 크래시 유발 코드 경로(route-generator 의 전체쌍 계산)를 타는 노드 집합은
 * — {@code nextsim.prune-unused-terminals}(기본 true) 하에서 — OD 매트릭스가 source/sink 로
 * 참조하는 노드로 정확히 좁혀진다({@code NextSimRunner.injectRequiredNetworkAttrs} 참고,
 * OD 미참조 터미널은 garage 로 강등되어 계산에서 빠짐). 따라서 "OD 저장 시점에, 이번에
 * 추가/제거된 노드만" 현재 degree 에 맞는 대역으로 재배정하면 충분하고, 다른 모든 기존
 * 참조(다른 OD 항목, 신호 등)는 건드리지 않아 정합성이 깨지지 않는다.
 *
 * <p>추가되는 노드: 지금 막 새로 참조되는 것이므로 이 id 를 참조하는 기존 데이터가
 * 있을 수 없다 — 안전하게 재배정 가능. 제거되는 노드: 더 이상 OD 가 참조하지 않게 되는
 * 순간 이미 그 역할(터미널)이 끝난 것이므로, 이 시점에 현재 degree 를 다시 확인해
 * 대역이 안 맞으면(예: 도로가 이어져 통과노드로 바뀐 경우) 정정한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OdTerminalIdBandService {

    private static final long TERMINAL_BAND_START = 11_000_000L;
    private static final long TERMINAL_BAND_END   = 12_000_000L; // exclusive
    private static final long NORMAL_BAND_START   = 10_000_000L;
    private static final long NORMAL_BAND_END     = 11_000_000L; // exclusive

    /** network.xml 을 풀 DOM 파싱하기엔 너무 큰 경우(대형 스트리밍망) 보정을 건너뜀 */
    private static final long MAX_NETWORK_XML_BYTES = 20_000_000L;

    private final FileStorageService fileStorage;
    private final NetworkJaxbParser networkJaxbParser;
    private final OdMatrixService odMatrixService;

    /**
     * OD 저장 직전 호출. oldOd(현재 저장된 OD, 없으면 null)와 newOd(저장하려는 OD)를 비교해
     * source/sink 로 추가되거나 제거된 노드만 골라 현재 degree 에 맞는 id 대역으로
     * 재배정하고, network.xml 에 즉시 반영(id/from_node/to_node 갱신 후 재업로드)한다.
     *
     * @return oldId(String)→newId(String) — 비어있으면 재배정 없음(newOd 그대로 사용 가능)
     */
    public Map<String, String> reconcileTerminalIds(String versionId, OdMatrixXml oldOd, OdMatrixXml newOd) {
        Set<String> oldIds = extractSourceSinkIds(oldOd);
        Set<String> newIds = extractSourceSinkIds(newOd);

        Set<String> touched = new HashSet<>(oldIds);
        touched.addAll(newIds);
        touched.removeAll(intersection(oldIds, newIds)); // 대칭차 — 추가되거나 제거된 것만
        if (touched.isEmpty()) return Map.of();

        NetworkXml network;
        byte[] xmlBytes;
        try {
            xmlBytes = fileStorage.readFile(versionId + "/network.xml");
        } catch (Exception e) {
            log.warn("[OdTerminalIdBandService] network.xml 읽기 실패, id 대역 보정 스킵: {}", e.getMessage());
            return Map.of();
        }
        if (xmlBytes.length > MAX_NETWORK_XML_BYTES) {
            log.warn("[OdTerminalIdBandService] network.xml {}MB — 대형망은 id 대역 보정 스킵",
                    xmlBytes.length / 1_000_000);
            return Map.of();
        }
        try {
            network = networkJaxbParser.parse(new ByteArrayInputStream(xmlBytes));
        } catch (Exception e) {
            log.warn("[OdTerminalIdBandService] network.xml 파싱 실패, id 대역 보정 스킵: {}", e.getMessage());
            return Map.of();
        }

        Map<String, String> strRemap = reconcileBands(network, touched);
        if (strRemap.isEmpty()) return Map.of();

        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            out.write(networkJaxbParser.marshal(network));
            fileStorage.uploadFile(new ByteArrayInputStream(out.toByteArray()), versionId, "network.xml");
        } catch (Exception e) {
            log.error("[OdTerminalIdBandService] network.xml id 재배정 반영 실패 — OD 저장 중단 필요: {}",
                    e.getMessage(), e);
            return Map.of();
        }

        log.info("[OdTerminalIdBandService] 터미널/일반 id 대역 재배정 {}건: {}", strRemap.size(), strRemap);
        return strRemap;
    }

    /**
     * 네트워크 편집(diff 저장) 직후 호출. OD 매트릭스 자체는 이번 저장에서 안 바뀌므로
     * "새로 추가/제거된 참조"라는 개념이 없다 — 대신 OD가 **현재 참조 중인 노드 전체**를
     * 이번에 병합된 네트워크의 실제 degree와 대조해 대역이 안 맞으면 보정한다.
     *
     * <p>{@code network}는 호출부(NetworkController)가 이미 메모리에 들고 있는(diff 병합된)
     * 것을 그대로 받아 in-place로 수정한다 — 재파싱도, network.xml 재업로드도 하지 않는다
     * (호출부가 어차피 곧 marshal/upload 하므로 여기서 중복으로 하지 않음). odmatrix.xml
     * 자체의 반영(source/sink 치환 + 재저장)도 호출부 책임 — 이 메서드는 remap만 계산한다.
     *
     * @return oldId(String)→newId(String) — 비어있으면 보정 없음
     */
    public Map<String, String> reconcileAfterNetworkEdit(String versionId, NetworkXml network) {
        OdMatrixXml currentOd;
        try {
            currentOd = odMatrixService.getByVersionId(versionId);
        } catch (Exception e) {
            return Map.of(); // OD 없음 — 대상 없음
        }
        Set<String> referencedIds = extractSourceSinkIds(currentOd);
        if (referencedIds.isEmpty()) return Map.of();

        Map<String, String> strRemap = reconcileBands(network, referencedIds);
        if (!strRemap.isEmpty()) {
            log.info("[OdTerminalIdBandService] 네트워크 편집 후 OD 참조 노드 대역 재배정 {}건: {}",
                    strRemap.size(), strRemap);
        }
        return strRemap;
    }

    /**
     * 공유 핵심 로직 — 주어진 {@code targetIds}(문자열 노드 id) 중 network의 실제 degree와
     * id 대역이 안 맞는 것만 골라 재배정하고, network의 node id / link from_node·to_node를
     * in-place로 갱신한다. network.xml의 읽기/업로드는 호출부 책임.
     */
    private Map<String, String> reconcileBands(NetworkXml network, Set<String> targetIds) {
        if (network.getNodes() == null) return Map.of();

        Map<Long, NodeXml> nodeById = new HashMap<>();
        Set<Long> existingIds = new HashSet<>();
        for (NodeXml n : network.getNodes()) {
            if (n.getId() == null) continue;
            nodeById.put(n.getId(), n);
            existingIds.add(n.getId());
        }

        long nextTerminal = maxInBand(existingIds, TERMINAL_BAND_START, TERMINAL_BAND_END) + 1;
        long nextNormal   = maxInBand(existingIds, NORMAL_BAND_START, NORMAL_BAND_END) + 1;
        if (nextTerminal <= TERMINAL_BAND_START) nextTerminal = TERMINAL_BAND_START;
        if (nextNormal <= NORMAL_BAND_START) nextNormal = NORMAL_BAND_START;

        Map<Long, Long> idRemap = new LinkedHashMap<>();
        for (String idStr : targetIds) {
            Long id;
            try { id = Long.parseLong(idStr); } catch (NumberFormatException e) { continue; }
            NodeXml node = nodeById.get(id);
            if (node == null) continue; // network.xml 에 없는(이미 낡은) 참조 — 무시

            int degree = node.getPorts() == null ? 0 : node.getPorts().size();
            boolean shouldBeTerminalBand = degree <= 1;
            boolean inTerminalBand = id >= TERMINAL_BAND_START && id < TERMINAL_BAND_END;
            boolean inNormalBand   = id >= NORMAL_BAND_START && id < NORMAL_BAND_END;
            if (shouldBeTerminalBand ? inTerminalBand : inNormalBand) continue; // 이미 대역이 맞음

            long newId;
            if (shouldBeTerminalBand) {
                newId = nextTerminal++;
                while (existingIds.contains(newId)) newId = nextTerminal++;
            } else {
                newId = nextNormal++;
                while (existingIds.contains(newId)) newId = nextNormal++;
            }
            idRemap.put(id, newId);
            existingIds.add(newId);
        }
        if (idRemap.isEmpty()) return Map.of();

        for (Map.Entry<Long, Long> e : idRemap.entrySet()) {
            nodeById.get(e.getKey()).setId(e.getValue());
        }
        if (network.getLinks() != null) {
            for (LinkXml link : network.getLinks()) {
                if (link.getFromNode() != null && idRemap.containsKey(link.getFromNode())) {
                    link.setFromNode(idRemap.get(link.getFromNode()));
                }
                if (link.getToNode() != null && idRemap.containsKey(link.getToNode())) {
                    link.setToNode(idRemap.get(link.getToNode()));
                }
            }
        }

        Map<String, String> strRemap = new LinkedHashMap<>();
        for (Map.Entry<Long, Long> e : idRemap.entrySet()) {
            strRemap.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
        }
        return strRemap;
    }

    /** idRemap 을 newOd 의 source/sink 참조에 반영(재배정된 노드가 OD 에 새로 추가되는 경우) */
    public void applyRemapToOdMatrix(OdMatrixXml od, Map<String, String> idRemap) {
        if (od == null || od.getOdMatrices() == null || idRemap.isEmpty()) return;
        for (OdMatrixXml.OdMatrixItemXml item : od.getOdMatrices()) {
            if (item.getNvodMatrix() == null || item.getNvodMatrix().getDemands() == null) continue;
            for (OdMatrixXml.DemandXml d : item.getNvodMatrix().getDemands()) {
                if (d.getSource() != null && idRemap.containsKey(d.getSource())) {
                    d.setSource(idRemap.get(d.getSource()));
                }
                if (d.getSink() != null && idRemap.containsKey(d.getSink())) {
                    d.setSink(idRemap.get(d.getSink()));
                }
            }
        }
    }

    private Set<String> extractSourceSinkIds(OdMatrixXml od) {
        Set<String> ids = new HashSet<>();
        if (od == null || od.getOdMatrices() == null) return ids;
        for (OdMatrixXml.OdMatrixItemXml item : od.getOdMatrices()) {
            if (item.getNvodMatrix() == null || item.getNvodMatrix().getDemands() == null) continue;
            for (OdMatrixXml.DemandXml d : item.getNvodMatrix().getDemands()) {
                if (d.getSource() != null) ids.add(d.getSource());
                if (d.getSink() != null) ids.add(d.getSink());
            }
        }
        return ids;
    }

    private Set<String> intersection(Set<String> a, Set<String> b) {
        Set<String> result = new HashSet<>(a);
        result.retainAll(b);
        return result;
    }

    private long maxInBand(Set<Long> ids, long start, long endExclusive) {
        long max = start - 1;
        for (long id : ids) {
            if (id >= start && id < endExclusive && id > max) max = id;
        }
        return max;
    }
}
