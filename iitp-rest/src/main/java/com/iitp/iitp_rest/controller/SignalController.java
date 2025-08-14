package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.signal.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.Arrays;

@RestController
@RequestMapping("/signal")
class SignalController {

    @GetMapping
    public ResponseEntity<SignalData> getSignalData() {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("scenario1/signal.xml")) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            Element signalElement = doc.getDocumentElement();
            SignalData signal = new SignalData();
            signal.setId(signalElement.getAttribute("id"));

            NodeList nodeList = signalElement.getElementsByTagName("node");
            for (int i = 0; i < nodeList.getLength(); i++) {
                Element nodeElement = (Element) nodeList.item(i);
                SignalNodeData node = new SignalNodeData();
                node.setId(nodeElement.getAttribute("id"));

                // turn_list
                NodeList turnNodes = ((Element) nodeElement.getElementsByTagName("turnList").item(0)).getElementsByTagName("turn");
                for (int j = 0; j < turnNodes.getLength(); j++) {
                    Element turnElement = (Element) turnNodes.item(j);
                    TurnData turn = new TurnData();
                    turn.setId(turnElement.getAttribute("id"));
                    turn.setTurning(turnElement.getAttribute("turning"));
                    turn.setType(turnElement.getAttribute("type"));

                    String[] connIds = turnElement.getAttribute("connList").trim().split("\\s+");
                    turn.setConnList(Arrays.asList(connIds));

                    node.getTurns().add(turn);
                }

                // plan_list
                NodeList planNodes = ((Element) nodeElement.getElementsByTagName("planList").item(0)).getElementsByTagName("plan");
                for (int j = 0; j < planNodes.getLength(); j++) {
                    Element planElement = (Element) planNodes.item(j);
                    PlanData plan = new PlanData();
                    plan.setId(planElement.getAttribute("id"));
                    plan.setCycle(Integer.parseInt(planElement.getAttribute("cycle")));
                    plan.setOffset(Integer.parseInt(planElement.getAttribute("offset")));

                    NodeList phaseNodes = planElement.getElementsByTagName("phase");
                    for (int k = 0; k < phaseNodes.getLength(); k++) {
                        Element phaseElement = (Element) phaseNodes.item(k);
                        PhaseData phase = new PhaseData();
                        phase.setId(phaseElement.getAttribute("id"));
                        phase.setDuration(Integer.parseInt(phaseElement.getAttribute("duration")));

                        String[] turns = phaseElement.getAttribute("turnList").trim().split("\\s+");
                        phase.setTurnList(Arrays.asList(turns));

                        plan.getPhases().add(phase);
                    }

                    node.getPlans().add(plan);
                }

                signal.getNodes().add(node);
                System.out.println(signal);
            }

            return ResponseEntity.ok(signal);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}

