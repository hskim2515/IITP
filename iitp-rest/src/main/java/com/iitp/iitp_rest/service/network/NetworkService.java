package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
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

    private final NetworkJaxbParser networkJaxbParser;
    private final ScenarioRepository scenarioRepository;

    public NetworkXml getNetworkXmlByScenarioKey(String scenarioKey) {
        String path = scenarioKey + "/network.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        NetworkXml dto = streamToDto(is);
        return transformNetworkCoordinates(scenarioKey, dto);
    }

    public NetworkXml streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        NetworkXml networkDto = networkJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData streamToDto total:{}", totalEnd - totalStart);
        return networkDto;
    }

    public NetworkXml transformNetworkCoordinates(String key, NetworkXml dto) {
        Scenario scenario = scenarioRepository.findByKey(key).orElse(new Scenario());
        double baseLatitude = scenario.getLatitude();
        double baseLongitude = scenario.getLongitude();

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

        populateConnectionLaneAnchors(dto);

        return dto;
    }

    private void populateConnectionLaneAnchors(NetworkXml dto) {
        if (dto == null || dto.getLinks() == null || dto.getNodes() == null) return;

        // Build link index: id → LinkData
        Map<Long, LinkXml> linkById = dto.getLinks().stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(LinkXml::getId, Function.identity(), (a, b) -> a));

        for (NodeXml node : dto.getNodes()) {
            Long nodeId = node.getId();
            if (nodeId == null) {
                log.warn("[populateConnectionLaneAnchors] Node id is null or not a number: {}", node.getId());
                continue;
            }
            if (node.getConnections() == null) continue;

            for (ConnectionXml conn : node.getConnections()) {
                Long fromLinkId = conn.getFromLink();
                Long toLinkId = conn.getToLink();
                LinkXml fromLink = fromLinkId != null ? linkById.get(fromLinkId) : null;
                LinkXml toLink = toLinkId != null ? linkById.get(toLinkId) : null;

                Coordinates fromLaneAnchor = new Coordinates();
                Coordinates toLaneAnchor = new Coordinates();

                if (fromLink != null) {
                    LaneXml fromLane = findLane(fromLink, conn.getFromLane());
                    if (fromLane != null && isNonEmpty(fromLane.getCoordinates())) {
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

                if (toLink != null) {
                    LaneXml toLane = findLane(toLink, conn.getToLane());
                    if (toLane != null && isNonEmpty(toLane.getCoordinates())) {
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

                conn.setFromLaneCoordinates(fromLaneAnchor);
                conn.setToLaneCoordinates(toLaneAnchor);
            }
        }
    }


    private static boolean isNonEmpty(List<?> list) {
        return list != null && !list.isEmpty();
    }

    private static LaneXml findLane(LinkXml link, Long laneIndex) {
        if (link == null || link.getLanes() == null) return null;

        String want = String.valueOf(laneIndex);
        for (LaneXml lane : link.getLanes()) {
            if (lane != null && want.equals(String.valueOf(lane.getId()))) {
                return lane;
            }
        }
        List<LaneXml> lanes = link.getLanes();
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