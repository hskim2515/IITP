package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.*;
import com.iitp.iitp_rest.repository.SignalLogsRepository;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.*;


@Service
@RequiredArgsConstructor
public class SignalService {
    private final SignalLogsRepository signalLogsRepository;
    private final SignalVersionsRepository signalVersionsRepository;

    public List<SignalLogs> getLogsByVersion(String id) {
        return signalLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveSignal(SignalSaveRequest request, String versionId) {
        SignalVersion version = signalVersionsRepository.findByVersionId(versionId)
                .orElse(new SignalVersion());

        version.setVersionId(versionId);
        version.setData(request.getData());
        signalVersionsRepository.save(version);

        List<SignalLogs> existingLogs = signalLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 20;
        if (existingLogs.size() >= maxLogs) {
            int removeCount = existingLogs.size() - maxLogs + 1;
            List<SignalLogs> toDelete = existingLogs.subList(0, removeCount);
            signalLogsRepository.deleteAll(toDelete);
        }

        SignalLogs logs = SignalLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        signalLogsRepository.save(logs);
    }

    public List<SignalResponse> getSignalDataFromXml(String versionId) throws Exception {
        List<SignalResponse> signalResponses = new ArrayList<>();

        try (InputStream is = getClass().getClassLoader().getResourceAsStream(versionId + "/signal.xml")) {
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

        return signalResponses;
    }

    public SignalVersion getSignalFromDatabase(String versionId) {
        return signalVersionsRepository.findByVersionId(versionId).orElse(new SignalVersion());
    }

}