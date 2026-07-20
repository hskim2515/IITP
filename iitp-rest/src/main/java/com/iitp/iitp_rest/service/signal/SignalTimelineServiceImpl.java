package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.SignalTimelineResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import com.iitp.iitp_rest.util.RemoteXmlFetch;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Arrays;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
@RequiredArgsConstructor
public class SignalTimelineServiceImpl implements SignalTimelineService {

    private static final Logger logger = LoggerFactory.getLogger(SignalTimelineServiceImpl.class);
    private static final DateTimeFormatter formatter = DateTimeFormatter.ISO_INSTANT;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    @Override
    public List<SignalTimelineResponse> generateSignalTimeline(long simulationStartTime, String targetPlanId, String dataPath, int simulationDurationSeconds) {
        List<SignalTimelineResponse> timelines = new ArrayList<>();

        String xmlUrl = remoteUrl + dataPath + "/signal.xml";
        try (InputStream is = RemoteXmlFetch.openStream(xmlUrl)) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            Element signalElement = doc.getDocumentElement();
            NodeList nodeList = signalElement.getElementsByTagName("node");

            // 시뮬레이션 전체 시간: 파라미터로 전달받음

            for (int i = 0; i < nodeList.getLength(); i++) {
                Element nodeElement = (Element) nodeList.item(i);
                String nodeId = nodeElement.getAttribute("id");

                List<SignalTimelineResponse.Turn> turnInfoList = new ArrayList<>();
                NodeList turnNodes = nodeElement.getElementsByTagName("turn");
                for (int t = 0; t < turnNodes.getLength(); t++) {
                    Element turnEl = (Element) turnNodes.item(t);
                    SignalTimelineResponse.Turn turn = new SignalTimelineResponse.Turn();
                    turn.setId(turnEl.getAttribute("id"));
                    turn.setTurning(turnEl.getAttribute("turning"));
                    turn.setType(turnEl.getAttribute("type"));

                    String connListStr = turnEl.getAttribute("connList");
                    if (connListStr.isEmpty()) connListStr = turnEl.getAttribute("conn_list");
                    List<String> connList = connListStr.isBlank() ? new ArrayList<>() : Arrays.asList(connListStr.trim().split("\\s+"));
                    turn.setConnList(connList);

                    turnInfoList.add(turn);
                }

                org.w3c.dom.Node planListNode = nodeElement.getElementsByTagName("planList").item(0);
                if (planListNode == null) continue;
                NodeList planList = ((Element) planListNode).getElementsByTagName("plan");
                if (planList.getLength() == 0) continue;

                // targetPlanId에 맞는 plan 찾기
                Element selectedPlan = null;
                for (int p = 0; p < planList.getLength(); p++) {
                    Element plan = (Element) planList.item(p);
                    String planId = plan.getAttribute("id");
                    if (planId.equals(targetPlanId)) {
                        selectedPlan = plan;
                        break;
                    }
                }

                if (selectedPlan == null) continue;

                int cycle = Integer.parseInt(selectedPlan.getAttribute("cycle"));
                int offset = Integer.parseInt(selectedPlan.getAttribute("offset"));

                NodeList phaseList = selectedPlan.getElementsByTagName("phase");

                List<SignalTimelineResponse.Timeline> timelineList = new ArrayList<>();

                // 시뮬레이션 시작시간 + offset 후 cycle 반복
                int cycleCount = (int) Math.ceil((double)(simulationDurationSeconds + offset) / cycle);

                Instant baseInstant = Instant.ofEpochSecond(simulationStartTime);

                for (int c = 0; c < cycleCount; c++) {
                    Instant cycleStart = baseInstant.plusSeconds(offset + c * cycle);
                    Instant currentTime = cycleStart;

                    for (int j = 0; j < phaseList.getLength(); j++) {
                        Element phaseElement = (Element) phaseList.item(j);
                        int duration = Integer.parseInt(phaseElement.getAttribute("duration"));
                        String turnListStr = phaseElement.getAttribute("turnList");
                        if (turnListStr.isEmpty()) turnListStr = phaseElement.getAttribute("turn_list");
                        String[] turnList = turnListStr.isBlank() ? new String[0] : turnListStr.trim().split("\\s+");

                        Instant endTime = currentTime.plusSeconds(duration);

                        if (duration > 3) {
                            // duration - 3초까지 초록불
                            SignalTimelineResponse.Timeline timelineGreen = new SignalTimelineResponse.Timeline();
                            timelineGreen.setStartTime(formatter.format(currentTime));
                            timelineGreen.setEndTime(formatter.format(currentTime.plusSeconds(duration - 3)));
                            timelineGreen.setActiveTurns(Arrays.asList(turnList));
                            timelineGreen.setSignalState("green");
                            timelineList.add(timelineGreen);

                            // 마지막 3초는 노란불
                            SignalTimelineResponse.Timeline timelineYellow = new SignalTimelineResponse.Timeline();
                            timelineYellow.setStartTime(formatter.format(currentTime.plusSeconds(duration - 3)));
                            timelineYellow.setEndTime(formatter.format(endTime));
                            timelineYellow.setActiveTurns(Arrays.asList(turnList));
                            timelineYellow.setSignalState("yellow");
                            timelineList.add(timelineYellow);
                        } else {
                            // duration이 3초 이하일 때는 그냥 전체 기간 초록불
                            SignalTimelineResponse.Timeline timelineGreen = new SignalTimelineResponse.Timeline();
                            timelineGreen.setStartTime(formatter.format(currentTime));
                            timelineGreen.setEndTime(formatter.format(endTime));
                            timelineGreen.setActiveTurns(Arrays.asList(turnList));
                            timelineGreen.setSignalState("green");
                            timelineList.add(timelineGreen);
                        }

                        currentTime = endTime;
                    }


                }

                // 결과 묶기
                SignalTimelineResponse response = new SignalTimelineResponse();
                response.setNodeId(nodeId);
                response.setSignalTimeline(timelineList);
                response.setTurnInfo(turnInfoList);

                timelines.add(response);
            }

        } catch (FileNotFoundException e) {
            logger.warn("[SignalTimeline] signal.xml 없음 (신호 타임라인 생략): {}", xmlUrl);
        } catch (Exception e) {
            logger.error("[SignalTimeline] signal.xml 파싱 오류: {}", xmlUrl, e);
        }

        return timelines;
    }
}
