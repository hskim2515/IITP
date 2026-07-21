package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.signal.*;
import com.iitp.iitp_rest.repository.SignalLogsRepository;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import com.iitp.iitp_rest.util.RemoteXmlFetch;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.io.InputStream;
import java.util.*;
import java.util.stream.Collectors;


@Slf4j
@Service
@RequiredArgsConstructor
public class SignalService {
    private final SignalLogsRepository signalLogsRepository;
    private final SignalVersionsRepository signalVersionsRepository;
    private final SignalJaxbParser signalJaxbParser;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public List<SignalLogs> getLogsByVersion(String id) {
        return signalLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveSignal(SignalSaveRequest request, String versionId) {
        SignalVersion latest = signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST).orElse(new SignalVersion());

        latest.setVersionId(versionId);
        latest.setVersionRole(BaseVersion.VersionRole.LATEST);
        latest.setData(request.getData());
        signalVersionsRepository.save(latest);

        // ORIGIN이 아직 없으면(예: XML 임포트로 처음 생긴 버전) 이번 저장 데이터를 복원 기준점으로
        // 생성 — getDataFromXml의 DOM 파서는 planList/phase를 읽지 않아 손실 변환이므로, 가능하면
        // 여기서(완전한 JAXB 파싱 결과로) 먼저 ORIGIN을 채워 HistoryModal 복원 품질을 보장한다.
        if (signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN).isEmpty()) {
            SignalVersion origin = new SignalVersion();
            origin.setVersionId(versionId);
            origin.setVersionRole(BaseVersion.VersionRole.ORIGIN);
            origin.setData(request.getData());
            signalVersionsRepository.save(origin);
        }

        List<SignalLogs> existingLogs = signalLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 10;
        if (existingLogs.size() >= maxLogs) {
            SignalVersion origin = signalVersionsRepository
                    .findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN)
                    .orElse(new SignalVersion());

            origin.setVersionId(versionId);
            origin.setVersionRole(BaseVersion.VersionRole.ORIGIN);
            origin.setData(latest.getData());
            signalVersionsRepository.save(origin);

            int removeCount = existingLogs.size() - (maxLogs - 1);
            if (removeCount > 0) {
                List<SignalLogs> toDelete = existingLogs.subList(0, removeCount);
                signalLogsRepository.deleteAll(toDelete);
            }
        }

        SignalLogs newLog = SignalLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        signalLogsRepository.save(newLog);
    }

    public SignalXml getSignalXmlByScenarioKey(String scenarioKey) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + scenarioKey + "/signal.xml");
        return streamToDto(is);
    }

    public SignalXml streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        SignalXml signalXmlDto = signalJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("SignalXml streamToDto total:{}", totalEnd - totalStart);
        return signalXmlDto;
    }

    @Transactional
    public List<SignalResponse> getDataFromXml(String versionId) throws Exception {
        List<SignalResponse> signalResponses = new ArrayList<>();

        try (InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/signal.xml")) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            NodeList nodeList = doc.getElementsByTagName("node");
            for (int i = 0; i < nodeList.getLength(); i++) {
                Element nodeEl = (Element) nodeList.item(i);
                String nodeId = nodeEl.getAttribute("id");

                NodeList turnNodes = nodeEl.getElementsByTagName("turn");
                for (int t = 0; t < turnNodes.getLength(); t++) {
                    Element turnEl = (Element) turnNodes.item(t);

                    String turnId = turnEl.getAttribute("id");
                    String turning = turnEl.getAttribute("turning");
                    String type = turnEl.getAttribute("type");

                    String connListStr = turnEl.getAttribute("connList");
                    List<String> connList = connListStr.isEmpty()
                            ? new ArrayList<>()
                            : Arrays.asList(connListStr.trim().split("\\s+"));

                    for (String connId : connList) {
                        SignalResponse td = new SignalResponse();
                        td.setTurnId(turnId);
                        td.setNodeId(nodeId);
                        td.setTurning(turning);
                        td.setType(type);
                        td.setConnectionId(connId);
                        signalResponses.add(td);
                    }
                }
            }
        }

        Optional<SignalVersion> originOpt = signalVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN);
        if (originOpt.isEmpty()) {
            signalLogsRepository.deleteByVersionId(versionId);

            SignalVersion originVersion = new SignalVersion();
            originVersion.setVersionId(versionId);
            originVersion.setVersionRole(BaseVersion.VersionRole.ORIGIN);
            originVersion.setData(signalResponses);
            signalVersionsRepository.save(originVersion);

            // find-or-create — XML 임포트(POST .../import)처럼 ORIGIN 없이 LATEST만 먼저 생긴
            // 버전에서 이 메서드가 호출되면(예: HistoryModal의 GET /origin), 여기서 무조건 새
            // SignalVersion을 만들면 기존 LATEST 행과 중복되어 findByVersionIdAndVersionRole이
            // 이후 2건을 만나 예외를 던진다(실측 재현) — 반드시 기존 행을 찾아 갱신해야 한다.
            SignalVersion latestVersion = signalVersionsRepository
                    .findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST)
                    .orElse(new SignalVersion());
            latestVersion.setVersionId(versionId);
            latestVersion.setVersionRole(BaseVersion.VersionRole.LATEST);
            latestVersion.setData(signalResponses);
            signalVersionsRepository.save(latestVersion);
        }
        return signalResponses;
    }

    public SignalVersion getDataFromDatabase(String versionId) {
        return signalVersionsRepository.findByVersionIdAndVersionRole(versionId,BaseVersion.VersionRole.LATEST).orElse(new SignalVersion());
    }

    public SignalVersion getOriginData(String versionId) {
        return signalVersionsRepository.findByVersionIdAndVersionRole(versionId,BaseVersion.VersionRole.ORIGIN).orElse(new SignalVersion());
    }

    /**
     * List&lt;SignalResponse&gt; (flat) → SignalXml (계층구조) 역변환.
     * nodeId 별로 그룹핑, 같은 turnId 는 connList 문자열로 합침.
     */
    public SignalXml toSignalXml(List<SignalResponse> responses) {
        // nodeId → (turnId → TurnListXml)
        Map<String, Map<String, SignalXml.TurnListXml>> nodeMap = new LinkedHashMap<>();
        // nodeId → planList (노드당 하나의 레코드에만 채워짐)
        Map<String, List<SignalResponse.PlanData>> planMap = new LinkedHashMap<>();
        for (SignalResponse r : responses) {
            String nid = r.getNodeId() != null ? r.getNodeId() : "";
            String tid = r.getTurnId() != null ? r.getTurnId() : "";
            nodeMap.computeIfAbsent(nid, k -> new LinkedHashMap<>());
            Map<String, SignalXml.TurnListXml> turnMap = nodeMap.get(nid);
            SignalXml.TurnListXml turn = turnMap.computeIfAbsent(tid, k -> {
                SignalXml.TurnListXml t = new SignalXml.TurnListXml();
                t.setId(tid);
                t.setTurning(r.getTurning());
                t.setType(r.getType());
                t.setConnList("");
                return t;
            });
            // connList 에 connectionId 추가
            if (r.getConnectionId() != null && !r.getConnectionId().isEmpty()) {
                String existing = turn.getConnList() != null ? turn.getConnList().trim() : "";
                turn.setConnList(existing.isEmpty() ? r.getConnectionId() : existing + " " + r.getConnectionId());
            }
            if (r.getPlans() != null && !r.getPlans().isEmpty()) {
                planMap.putIfAbsent(nid, r.getPlans());
            }
        }

        List<SignalXml.SignalNodeXml> nodes = new ArrayList<>();
        for (Map.Entry<String, Map<String, SignalXml.TurnListXml>> entry : nodeMap.entrySet()) {
            SignalXml.SignalNodeXml node = new SignalXml.SignalNodeXml();
            try { node.setId(Long.parseLong(entry.getKey())); } catch (NumberFormatException ignore) {}
            node.setTurns(new ArrayList<>(entry.getValue().values()));

            List<SignalResponse.PlanData> plans = planMap.get(entry.getKey());
            if (plans != null) {
                node.setPlans(plans.stream().map(p -> {
                    SignalXml.PlanListXml px = new SignalXml.PlanListXml();
                    px.setId(p.getId());
                    px.setCycle(p.getCycle());
                    px.setOffset(p.getOffset());
                    if (p.getPhases() != null) {
                        px.setPhase(p.getPhases().stream().map(ph -> {
                            SignalXml.PhaseXml phx = new SignalXml.PhaseXml();
                            phx.setId(ph.getId());
                            phx.setDuration(ph.getDuration());
                            phx.setTurnList(ph.getTurnList());
                            return phx;
                        }).collect(Collectors.toList()));
                    }
                    return px;
                }).collect(Collectors.toList()));
            }
            nodes.add(node);
        }

        SignalXml xml = new SignalXml();
        xml.setNode(nodes);
        return xml;
    }

    /**
     * SignalXml(계층구조) → List&lt;SignalResponse&gt;(flat) 순변환. toSignalXml()의 역변환.
     * turn 하나당 connList 공백 구분 토큰 개수만큼 SignalResponse 레코드로 펼치고(getDataFromXml과
     * 동일 규칙), plans는 노드당 하나의 레코드에만 채운다(toSignalXml의 planMap.putIfAbsent와 대칭).
     */
    public List<SignalResponse> fromSignalXml(SignalXml xml) {
        List<SignalResponse> responses = new ArrayList<>();
        if (xml.getNode() == null) return responses;

        for (SignalXml.SignalNodeXml node : xml.getNode()) {
            String nodeId = node.getId() != null ? String.valueOf(node.getId()) : "";

            List<SignalResponse.PlanData> plans = null;
            if (node.getPlans() != null && !node.getPlans().isEmpty()) {
                plans = node.getPlans().stream().map(p -> {
                    SignalResponse.PlanData pd = new SignalResponse.PlanData();
                    pd.setId(p.getId());
                    pd.setCycle(p.getCycle());
                    pd.setOffset(p.getOffset());
                    if (p.getPhase() != null) {
                        pd.setPhases(p.getPhase().stream().map(ph -> {
                            SignalResponse.PhaseData phd = new SignalResponse.PhaseData();
                            phd.setId(ph.getId());
                            phd.setDuration(ph.getDuration());
                            phd.setTurnList(ph.getTurnList());
                            return phd;
                        }).collect(Collectors.toList()));
                    }
                    return pd;
                }).collect(Collectors.toList());
            }

            boolean firstTurnForNode = true;
            if (node.getTurns() != null) {
                for (SignalXml.TurnListXml turn : node.getTurns()) {
                    String connListStr = turn.getConnList() != null ? turn.getConnList().trim() : "";
                    List<String> connList = connListStr.isEmpty()
                            ? new ArrayList<>()
                            : Arrays.asList(connListStr.split("\\s+"));

                    if (connList.isEmpty()) {
                        SignalResponse r = new SignalResponse();
                        r.setNodeId(nodeId);
                        r.setTurnId(turn.getId());
                        r.setTurning(turn.getTurning());
                        r.setType(turn.getType());
                        if (firstTurnForNode) { r.setPlans(plans); firstTurnForNode = false; }
                        responses.add(r);
                        continue;
                    }
                    for (String connId : connList) {
                        SignalResponse r = new SignalResponse();
                        r.setNodeId(nodeId);
                        r.setTurnId(turn.getId());
                        r.setTurning(turn.getTurning());
                        r.setType(turn.getType());
                        r.setConnectionId(connId);
                        if (firstTurnForNode) { r.setPlans(plans); firstTurnForNode = false; }
                        responses.add(r);
                    }
                }
            }
        }
        return responses;
    }

}