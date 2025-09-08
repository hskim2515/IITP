package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXmlResponse;
import com.iitp.iitp_rest.model.network.connection.ConnectionXmlResponse;
import com.iitp.iitp_rest.model.network.lane.LaneXmlResponse;
import com.iitp.iitp_rest.model.network.link.LinkXmlResponse;
import com.iitp.iitp_rest.model.network.node.NodeXmlResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkService {

    private final NetworkXmlParser networkXmlParser;
    private final NetworkJaxbParser networkJaxbParser;


    private final ScenarioRepository scenarioRepository;

    public NetworkXmlResponse getNetwork(String key) {
        String path = key + "/network.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        NetworkXmlResponse dto = streamToDto(is);
        return transformNetworkCoordinates(key, dto);
    }

    public NetworkXmlResponse streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
//        NetworkXmlResponse networkDto = networkXmlParser.parse(is);
        NetworkXmlResponse networkDto = networkJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData streamToDto total:{}", totalEnd - totalStart);
        return networkDto;
    }

    /**
     * 1) Node/Link/Lane의 shape 문자열 → 좌표 변환
     * 2) 변환 완료 후, 각 Node의 connection에 대해 from/to lane 앵커 좌표를 채움
     * <p>
     * 1) Convert shapes to coordinates for Node/Link/Lane
     * 2) After conversion, populate from/to lane anchor coordinates for each Node's connections
     */
    public NetworkXmlResponse transformNetworkCoordinates(String key, NetworkXmlResponse dto) {
        // 1. 기준점 및 스케일 준비 / Prepare base point & scale
        Scenario scenario = scenarioRepository.findByKey(key).orElse(new Scenario());
        double baseLatitude = scenario.getLatitude();
        double baseLongitude = scenario.getLongitude();

        // 2. Nodes & Connections: node.center / connection.shape → coordinates
        dto.getNodes().forEach(node -> {
            List<Coordinates> transformedNodeCoords = CoordinateUtils.parseAndTransform(
                    node.getCenter(), baseLongitude, baseLatitude
            );
            if (!transformedNodeCoords.isEmpty()) {
                node.setCoordinates(transformedNodeCoords.getFirst());
            }

            node.getConnections().forEach(connection ->
                    connection.setCoordinates(CoordinateUtils.parseAndTransform(
                            connection.getShape(), baseLongitude, baseLatitude
                    ))
            );
        });

        // 3. Links & Lanes: link.shape / lane.shape → coordinates
        dto.getLinks().forEach(link -> {
            link.setCoordinates(CoordinateUtils.parseAndTransform(
                    link.getShape(), baseLongitude, baseLatitude
            ));
            link.getLanes().forEach(lane ->
                    lane.setCoordinates(CoordinateUtils.parseAndTransform(
                            lane.getShape(), baseLongitude, baseLatitude
                    ))
            );
        });

        // 4. 각 connection에 from/to lane의 "노드측 1개 점"을 채움
        //    Populate node-side single anchor point for from/to lane of each connection
        populateConnectionLaneAnchors(dto);

        return dto;
    }

    /**
     * 각 Node의 connection에 대해,
     * - fromLaneCoordinates: from_link의 해당 lane에서 노드측 끝점 1개
     * - toLaneCoordinates:   to_link의 해당 lane에서 노드측 시작점 1개
     * <p>
     * For every Node's connection:
     * - fromLaneCoordinates: 1 node-side endpoint from the lane of from_link
     * - toLaneCoordinates:   1 node-side startpoint from the lane of to_link
     */
    private void populateConnectionLaneAnchors(NetworkXmlResponse dto) {
        if (dto == null || dto.getLinks() == null || dto.getNodes() == null) return;

        // Build link index: id → LinkData
        Map<Long, LinkXmlResponse> linkById = dto.getLinks().stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(LinkXmlResponse::getId, Function.identity(), (a, b) -> a));

        for (NodeXmlResponse node : dto.getNodes()) {
            Long nodeId = node.getId();
            if (nodeId == null) {
                log.warn("[populateConnectionLaneAnchors] Node id is null or not a number: {}", node.getId());
                continue;
            }
            if (node.getConnections() == null) continue;

            for (ConnectionXmlResponse conn : node.getConnections()) {
                // Lookup from/to links
                Long fromLinkId = conn.getFromLink();
                Long toLinkId = conn.getToLink();
                LinkXmlResponse fromLink = fromLinkId != null ? linkById.get(fromLinkId) : null;
                LinkXmlResponse toLink = toLinkId != null ? linkById.get(toLinkId) : null;

                // Prepare result lists (single point each)
                Coordinates fromLaneAnchor = new Coordinates();
                Coordinates toLaneAnchor = new Coordinates();

                // --- from side ---
                if (fromLink != null) {
                    LaneXmlResponse fromLane = findLane(fromLink, conn.getFromLane());
                    if (fromLane != null && isNonEmpty(fromLane.getCoordinates())) {
                        // 노드가 link.toNode이면 incoming → 마지막 점 / if node==toNode => incoming → last point
                        // 노드가 link.fromNode이면 outgoing → 첫 점 / if node==fromNode => outgoing → first point
                        boolean nodeIsTo = Objects.equals(fromLink.getToNode(), nodeId);
                        Coordinates anchor = nodeIsTo
                                ? last(fromLane.getCoordinates())
                                : first(fromLane.getCoordinates());
                        fromLaneAnchor = anchor;
                    } else {
                        log.warn("[populateConnectionLaneAnchors] Missing fromLane or coordinates: node={}, connId={}, fromLink={}, fromLane={}",
                                node.getId(), conn.getId(), conn.getFromLink(), conn.getFromLane());
                    }
                } else {
                    log.warn("[populateConnectionLaneAnchors] Missing fromLink: node={}, connId={}, fromLink={}",
                            node.getId(), conn.getId(), conn.getFromLink());
                }

                // --- to side ---
                if (toLink != null) {
                    LaneXmlResponse toLane = findLane(toLink, conn.getToLane());
                    if (toLane != null && isNonEmpty(toLane.getCoordinates())) {
                        // 노드가 link.fromNode이면 outgoing 시작점 → 첫 점 / if node==fromNode => outgoing start → first point
                        // 노드가 link.toNode이면 incoming 말단 → 마지막 점 / if node==toNode => incoming end → last point
                        boolean nodeIsFrom = Objects.equals(toLink.getFromNode(), nodeId);
                        Coordinates anchor = nodeIsFrom
                                ? first(toLane.getCoordinates())
                                : last(toLane.getCoordinates());
                        toLaneAnchor = anchor;
                    } else {
                        log.warn("[populateConnectionLaneAnchors] Missing toLane or coordinates: node={}, connId={}, toLink={}, toLane={}",
                                node.getId(), conn.getId(), conn.getToLink(), conn.getToLane());
                    }
                } else {
                    log.warn("[populateConnectionLaneAnchors] Missing toLink: node={}, connId={}, toLink={}",
                            node.getId(), conn.getId(), conn.getToLink());
                }

                // Apply
                conn.setFromLaneCoordinates(fromLaneAnchor);
                conn.setToLaneCoordinates(toLaneAnchor);
            }
        }
    }


    private static boolean isNonEmpty(List<?> list) {
        return list != null && !list.isEmpty();
    }

    /**
     * lane.id(문자열) == 요청 인덱스(정수)의 문자열 매칭을 우선,
     * 실패 시 0-based 인덱스 접근을 fallback 으로 사용.
     * <p>
     * Prefer lane.id(String) == index(String) matching, fallback to 0-based index.
     */
    private static LaneXmlResponse findLane(LinkXmlResponse link, Long laneIndex) {
        if (link == null || link.getLanes() == null) return null;

        String want = String.valueOf(laneIndex);
        for (LaneXmlResponse lane : link.getLanes()) {
            if (lane != null && want.equals(lane.getId())) {
                return lane;
            }
        }
        // fallback by 0-based index
        List<LaneXmlResponse> lanes = link.getLanes();
        if (laneIndex >= 0 && laneIndex < lanes.size()) {
            return lanes.get(Math.toIntExact(laneIndex));
        }
        return null;
    }

    private static Coordinates first(List<Coordinates> list) {
        return list.get(0);
    }

    private static Coordinates last(List<Coordinates> list) {
        return list.get(list.size() - 1);
    }


}