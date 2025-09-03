package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.mapper.network.*;
import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.*;
import com.iitp.iitp_rest.model.network.node.*;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.LaneRepository;
import com.iitp.iitp_rest.repository.LinkRepository;
import com.iitp.iitp_rest.repository.NetworkRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.XmlUtils;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.xml.stream.XMLStreamException;
import java.io.IOException;
import java.io.InputStream;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkService {

    private final NetworkXmlParser networkXmlParser;
    private final NetworkJaxbParser networkJaxbParser;

    private final ScenarioRepository scenarioRepository;
    private final NetworkRepository networkRepository;

    private final NetworkMapper networkMapper;
    private final NodeMapper nodeMapper;
    private final LinkMapper linkMapper;
    private final LaneMapper laneMapper;
    private final CellMapper cellMapper;
    private final SegmentMapper segmentMapper;
    private final PortMapper portMapper;

    private static final double SCALE_X = 1.0 / 88000.0;
    private static final double SCALE_Y = 1.0 / 111000.0;

    public NetworkResponse streamToDto(InputStream is) throws XMLStreamException {
        final long totalStart = System.nanoTime();
        NetworkResponse networkDto = networkXmlParser.parse(is);
//        NetworkResponse networkDto = networkJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData streamToDto total:{}", totalEnd - totalStart);
        return networkDto;
    }

//    @Transactional // <- 핵심: 자기호출 문제 회피(쓰기 경로 보장). 대안: WriteService 분리
    public NetworkResponse getOrLoad(String key) throws Exception {
//        // 1) 먼저 조회 (읽기 경로)
        final long findStart = System.nanoTime();
        Optional<Long> id = networkRepository.findIdByName(key);
        if (id.isPresent()) {
            Optional<Network> entityOpt = networkRepository.findById(id.get());
            if(entityOpt.isPresent()) {
                final long findEnd = System.nanoTime();
                log.info("NetworkData find:{}", findEnd - findStart);
                NetworkResponse response = networkMapper.toDto(entityOpt.get());
                final long toDtoEnd = System.nanoTime();
                log.info("NetworkData toDto:{}", toDtoEnd -findEnd);
                return response;
            }
        }
        return new NetworkResponse();
//
//        // 2) 없으면 생성 경로 (동시성 대비: 트랜잭션 내부에서 한 번 더 확인)
//        String path = key + "/network.xml";
//        try (InputStream is = XmlUtils.loadXmlAsStream(path)) {
//            // 파싱
//            NetworkResponse parsed = streamToDto(is);
//
//            // 좌표/앵커 변환(반환용) — DB에 좌표를 저장하지 않는다면 여기서만 계산
//            NetworkResponse transformed = transformNetworkCoordinates(key, parsed);
//
//            // 저장: 논리키 기반 맵을 사용하도록 save 내부도 교정(아래 B 참고)
//            Network saved = save(transformed, key); // 반환 타입 변경: 저장된 엔티티 반환
//
//            // 최종 응답: 방금 저장한 엔티티를 DTO로 변환해 일관성 보장
//            return networkMapper.toDto(saved);
//        } catch (DataIntegrityViolationException | IOException dup) {
//            // 유니크 제약(시나리오명) 충돌 시: 경쟁 승자 재조회
//            return networkRepository.findIdByName(key)
//                    .map(networkMapper::toDto)
//                    .orElseThrow(() -> dup);
//        }
    }


    @Transactional
    public Network save(NetworkResponse networkDto, String scenarioName) {
        Network networkEntity = networkMapper.toEntity(networkDto);
        networkEntity.setName(scenarioName);
        // 2. Node 엔티티 리스트 생성 (아직 Port, Connection은 비어있음)
        for (NodeResponse nodeDto : networkDto.getNodes()) {
            Node nodeEntity = nodeMapper.toEntity(nodeDto, networkEntity);
            networkEntity.addNode(nodeEntity);
        }

        // 3. Link 엔티티 리스트 및 하위 요소(Lane, Cell, Segment) 생성
        for (LinkResponse linkDto : networkDto.getLinks()) {
            Link linkEntity = linkMapper.toEntity(linkDto, networkEntity);

            if (linkDto.getLanes() != null) {
                for (LaneResponse laneDto : linkDto.getLanes()) {
                    Lane laneEntity = laneMapper.toEntity(laneDto, linkEntity);

                    // Lane의 하위 요소들 매핑
                    List<Cell> cellEntities = cellMapper.toEntities(laneDto.getCells(), laneEntity);
                    cellEntities.forEach(laneEntity::addCell);

                    List<Segment> segmentEntities = segmentMapper.toEntities(laneDto.getSegments(), laneEntity);
                    segmentEntities.forEach(laneEntity::addSegment);

                    linkEntity.addLane(laneEntity);
                }
            }
            networkEntity.addLink(linkEntity);
        }

        // 4. DB에 Network와 모든 하위 요소를 한번에 저장 (ID 생성 목적)
        networkRepository.saveAndFlush(networkEntity);

        // 5. Connection 처리를 위해 Link와 Lane을 Map으로 만들어 빠른 조회 지원
        Map<Long, Link> linkMap = networkEntity.getLinks().stream()
                .collect(Collectors.toMap(Link::getId, Function.identity()));

        Map<String, Lane> laneMap = networkEntity.getLinks().stream()
                .flatMap(link -> link.getLanes().stream())
                .collect(Collectors.toMap(lane -> lane.getLink().getId() + "_" + lane.getId(), Function.identity()));

        // 6. Node를 다시 순회하며 Port와 Connection 관계 설정
        for (int i = 0; i < networkEntity.getNodes().size(); i++) {
            Node nodeEntity = networkEntity.getNodes().get(i);
            NodeResponse nodeDto = networkDto.getNodes().get(i);

            // Port 추가
            List<Port> portEntities = portMapper.toEntities(nodeDto.getPorts(), nodeEntity);
            portEntities.forEach(nodeEntity::addPort);

            // Connection 추가 (ID 기반 조회 및 관계 설정)
            if (nodeDto.getConnections() != null) {
                for (ConnectionResponse connDto : nodeDto.getConnections()) {
                    Link fromLink = linkMap.get(connDto.getFromLink());
                    Lane fromLane = laneMap.get(connDto.getFromLink() + "_" + connDto.getFromLane());
                    Link toLink = linkMap.get(connDto.getToLink());
                    Lane toLane = laneMap.get(connDto.getToLink() + "_" + connDto.getToLane());

                    if(fromLink == null || fromLane == null || toLink == null || toLane == null) {
                        continue;
                    }

                    Connection connection = Connection.builder()
                            .id(Long.valueOf(connDto.getId()))
                            .fromLink(fromLink.getId())
                            .fromLane(fromLane.getId())
                            .toLink(toLink.getId())
                            .toLane(toLane.getId())
                            .turning(connDto.getTurning())
                            .length(connDto.getLength())
                            .width(connDto.getWidth())
                            .ffSpd(connDto.getFfSpd())
                            .shape(connDto.getShape())
                            .build();

                    nodeEntity.addConnection(connection);
                }
            }
        }

        // 7. 모든 관계가 완전히 설정된 Network를 최종 저장 (Update)
        return networkRepository.save(networkEntity);
    }



    /**
     * 1) Node/Link/Lane의 shape 문자열 → 좌표 변환
     * 2) 변환 완료 후, 각 Node의 connection에 대해 from/to lane 앵커 좌표를 채움
     * <p>
     * 1) Convert shapes to coordinates for Node/Link/Lane
     * 2) After conversion, populate from/to lane anchor coordinates for each Node's connections
     */
    public NetworkResponse transformNetworkCoordinates(String key, NetworkResponse dto) {
        // 1. 기준점 및 스케일 준비 / Prepare base point & scale
        Scenario scenario = scenarioRepository.findByKey(key).orElse(new Scenario());
        double baseLatitude = scenario.getLatitude();
        double baseLongitude = scenario.getLongitude();

        // 2. Nodes & Connections: node.center / connection.shape → coordinates
        dto.getNodes().forEach(node -> {
            List<Coordinates> transformedNodeCoords = CoordinateUtils.parseAndTransform(
                    node.getCenter(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
            );
            if (!transformedNodeCoords.isEmpty()) {
                node.setCoordinates(transformedNodeCoords.getFirst());
            }

            node.getConnections().forEach(connection ->
                    connection.setCoordinates(CoordinateUtils.parseAndTransform(
                            connection.getShape(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
                    ))
            );
        });

        // 3. Links & Lanes: link.shape / lane.shape → coordinates
        dto.getLinks().forEach(link -> {
            link.setCoordinates(CoordinateUtils.parseAndTransform(
                    link.getShape(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
            ));
            link.getLanes().forEach(lane ->
                    lane.setCoordinates(CoordinateUtils.parseAndTransform(
                            lane.getShape(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
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
    private void populateConnectionLaneAnchors(NetworkResponse dto) {
        if (dto == null || dto.getLinks() == null || dto.getNodes() == null) return;

        // Build link index: id → LinkData
        Map<Long, LinkResponse> linkById = dto.getLinks().stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(LinkResponse::getId, Function.identity(), (a, b) -> a));

        for (NodeResponse node : dto.getNodes()) {
            Long nodeId = node.getId();
            if (nodeId == null) {
                log.warn("[populateConnectionLaneAnchors] Node id is null or not a number: {}", node.getId());
                continue;
            }
            if (node.getConnections() == null) continue;

            for (ConnectionResponse conn : node.getConnections()) {
                // Lookup from/to links
                Long fromLinkId = conn.getFromLink();
                Long toLinkId = conn.getToLink();
                LinkResponse fromLink = fromLinkId != null ? linkById.get(fromLinkId) : null;
                LinkResponse toLink = toLinkId != null ? linkById.get(toLinkId) : null;

                // Prepare result lists (single point each)
                Coordinates fromLaneAnchor = new Coordinates();
                Coordinates toLaneAnchor = new Coordinates();

                // --- from side ---
                if (fromLink != null) {
                    LaneResponse fromLane = findLane(fromLink, conn.getFromLane());
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
                    LaneResponse toLane = findLane(toLink, conn.getToLane());
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
    private static LaneResponse findLane(LinkResponse link, Long laneIndex) {
        if (link == null || link.getLanes() == null) return null;

        String want = String.valueOf(laneIndex);
        for (LaneResponse lane : link.getLanes()) {
            if (lane != null && want.equals(lane.getId())) {
                return lane;
            }
        }
        // fallback by 0-based index
        List<LaneResponse> lanes = link.getLanes();
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
