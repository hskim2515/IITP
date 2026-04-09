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

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.*;


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
        InputStream is = new URL(remoteUrl + scenarioKey + "/signal.xml").openStream();
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

        try (InputStream is = new URL(remoteUrl + versionId + "/signal.xml").openStream()) {
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

            SignalVersion latestVersion = new SignalVersion();
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
        }

        List<SignalXml.SignalNodeXml> nodes = new ArrayList<>();
        for (Map.Entry<String, Map<String, SignalXml.TurnListXml>> entry : nodeMap.entrySet()) {
            SignalXml.SignalNodeXml node = new SignalXml.SignalNodeXml();
            try { node.setId(Long.parseLong(entry.getKey())); } catch (NumberFormatException ignore) {}
            node.setTurns(new ArrayList<>(entry.getValue().values()));
            nodes.add(node);
        }

        SignalXml xml = new SignalXml();
        xml.setNode(nodes);
        return xml;
    }

}