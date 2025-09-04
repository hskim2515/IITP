package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.mapper.network.*;
import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkTreeResponse;
import com.iitp.iitp_rest.model.network.NetworkXmlResponse;
import com.iitp.iitp_rest.model.network.cell.Cell;
import com.iitp.iitp_rest.model.network.cell.CellResponse;
import com.iitp.iitp_rest.model.network.cell.CellTreeResponse;
import com.iitp.iitp_rest.model.network.connection.Connection;
import com.iitp.iitp_rest.model.network.connection.ConnectionTreeResponse;
import com.iitp.iitp_rest.model.network.connection.ConnectionXmlResponse;
import com.iitp.iitp_rest.model.network.lane.Lane;
import com.iitp.iitp_rest.model.network.lane.LaneTreeResponse;
import com.iitp.iitp_rest.model.network.lane.LaneXmlResponse;
import com.iitp.iitp_rest.model.network.link.*;
import com.iitp.iitp_rest.model.network.node.*;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.port.Port;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import com.iitp.iitp_rest.model.network.port.PortTreeResponse;
import com.iitp.iitp_rest.model.network.segment.Segment;
import com.iitp.iitp_rest.model.network.segment.SegmentTreeResponse;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.repository.*;
import com.iitp.iitp_rest.util.CoordinateUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.xml.stream.XMLStreamException;
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

    private static final int PARTITION_SIZE = 900;

    private final ScenarioRepository scenarioRepository;
    private final NetworkRepository networkRepository;
    private final NodeRepository nodeRepository;
    private final LinkRepository linkRepository;
    private final CellRepository cellRepository;
    private final ConnectionRepository connectionRepository;
    private final LaneRepository laneRepository;
    private final PortRepository portRepository;
    private final SegmentRepository segmentRepository;

    private final NetworkMapper networkMapper;
    private final NodeMapper nodeMapper;
    private final LinkMapper linkMapper;
    private final LaneMapper laneMapper;
    private final CellMapper cellMapper;
    private final ConnectionMapper connectionMapper;
    private final SegmentMapper segmentMapper;
    private final PortMapper portMapper;

    private static final double SCALE_X = 1.0 / 88000.0;
    private static final double SCALE_Y = 1.0 / 111000.0;

    public NetworkXmlResponse streamToDto(InputStream is) throws XMLStreamException {
        final long totalStart = System.nanoTime();
//        NetworkXmlResponse networkDto = networkXmlParser.parse(is);
        NetworkXmlResponse networkDto = networkJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData streamToDto total:{}", totalEnd - totalStart);
        return networkDto;
    }

    public NetworkTreeResponse getNetworkTree(String key) {
        final long totalStart = System.nanoTime();
        // 1. 루트 DTO 조회 및 예외 처리
        NetworkTreeResponse rootDto = networkRepository.findNetworkTreeByName(key);
        if (rootDto == null) {
            return null;
        }
        Long networkId = rootDto.getId();

        // 2. Node DTO 목록 조회
        List<NodeTreeResponse> nodeDtos = nodeRepository.findNodeTreeByNetworkId(networkId);
        if (nodeDtos.isEmpty()) {
            return rootDto; // Node가 없으면 바로 반환
        }

        // 3. 하위 요소 조립을 위한 준비
        List<Long> nodeIds = nodeDtos.stream().map(NodeTreeResponse::getId).toList();

        // 4. Port 목록 분할 조회
        List<PortTreeResponse> portDtos = new ArrayList<>();
        for (int i = 0; i < nodeIds.size(); i += PARTITION_SIZE) {
            List<Long> sublist = nodeIds.subList(i, Math.min(i + PARTITION_SIZE, nodeIds.size()));
            portDtos.addAll(portRepository.findPortDtoByNodeIds(sublist));
        }

        // 5. Connection 목록 분할 조회 (이 부분이 추가되어야 합니다)
        List<ConnectionTreeResponse> connectionDtos = new ArrayList<>();
        for (int i = 0; i < nodeIds.size(); i += PARTITION_SIZE) {
            List<Long> sublist = nodeIds.subList(i, Math.min(i + PARTITION_SIZE, nodeIds.size()));
            connectionDtos.addAll(connectionRepository.findConnectionDtoByNodeIds(sublist));
        }

        // 6. Map으로 변환하여 조립 준비
        Map<Long, List<PortTreeResponse>> portMap = portDtos.stream()
                .collect(Collectors.groupingBy(PortTreeResponse::getNodeId));
        Map<Long, List<ConnectionTreeResponse>> connectionMap = connectionDtos.stream()
                .collect(Collectors.groupingBy(ConnectionTreeResponse::getNodeId));

        // 7. Node DTO에 하위 요소들(Port, Connection) 조립
        nodeDtos.forEach(node -> {
            node.setPorts(portMap.getOrDefault(node.getId(), Collections.emptyList()));
            node.setConnections(connectionMap.getOrDefault(node.getId(), Collections.emptyList()));
        });

        rootDto.setNodes(nodeDtos);

        List<LinkTreeResponse> linkDtos = linkRepository.findLinkTreeByNetworkId(networkId);
        if (!linkDtos.isEmpty()) {

            // 2-1. Lane 조회를 위한 Link ID 추출
            List<Long> linkIds = linkDtos.stream().map(LinkTreeResponse::getId).toList();
            List<LaneTreeResponse> laneDtos = laneRepository.findLaneTreeByLinkIds(linkIds);

            if (!laneDtos.isEmpty()) {
                // 2-2. Cell/Segment 조회를 위한 Lane ID 추출
                List<Long> laneIds = laneDtos.stream().map(LaneTreeResponse::getId).toList();

                // 2-3. Cell/Segment DTO 목록 일괄 조회
                List<CellTreeResponse> cellDtos = cellRepository.findCellTreeByLaneIds(laneIds);
                List<SegmentTreeResponse> segmentDtos = segmentRepository.findSegmentTreeByLaneIds(laneIds);

                // 2-4. 조립을 위해 Map으로 변환 (Bottom-up)
                Map<Long, List<CellTreeResponse>> cellMap = cellDtos.stream()
                        .collect(Collectors.groupingBy(CellTreeResponse::getLaneId));
                Map<Long, List<SegmentTreeResponse>> segmentMap = segmentDtos.stream()
                        .collect(Collectors.groupingBy(SegmentTreeResponse::getLaneId));

                // 2-5. Lane에 Cell과 Segment 조립
                laneDtos.forEach(lane -> {
                    lane.setCells(cellMap.getOrDefault(lane.getId(), Collections.emptyList()));
                    lane.setSegments(segmentMap.getOrDefault(lane.getId(), Collections.emptyList()));
                });
            }

            // 2-6. Link에 Lane 조립
            Map<Long, List<LaneTreeResponse>> laneMap = laneDtos.stream()
                    .collect(Collectors.groupingBy(LaneTreeResponse::getLinkId));
            linkDtos.forEach(link ->
                    link.setLanes(laneMap.getOrDefault(link.getId(), Collections.emptyList()))
            );
        }

        // --- 3. 최종 조립 ---
        rootDto.setLinks(linkDtos);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData get tree total:{}", totalEnd - totalStart);
        return rootDto;
    }

    public NetworkXmlResponse getOrLoad(String key) throws Exception {
//        // 1) 먼저 조회 (읽기 경로)
        final long findStart = System.nanoTime();
        Optional<Long> id = networkRepository.findIdByName(key);
        if (id.isPresent()) {
            Optional<Network> entityOpt = networkRepository.findById(id.get());
            if (entityOpt.isPresent()) {
                final long findEnd = System.nanoTime();
                log.info("NetworkData find:{}", findEnd - findStart);
                NetworkXmlResponse response = networkMapper.toDto(entityOpt.get());
                final long toDtoEnd = System.nanoTime();
                log.info("NetworkData toDto:{}", toDtoEnd - findEnd);
                return response;
            }
        }
        return new NetworkXmlResponse();
    }
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
//
//
//    @Transactional
//    public Network save(NetworkXmlResponse networkDto, String scenarioName) {
//        Network networkEntity = networkMapper.xmlToEntity(networkDto);
//        networkEntity.setName(scenarioName);
//        // 2. Node 엔티티 리스트 생성 (아직 Port, Connection은 비어있음)
//        for (NodeXmlResponse nodeDto : networkDto.getNodes()) {
//            Node nodeEntity = nodeMapper.xmlToEntity(nodeDto, networkEntity);
//            networkEntity.addNode(nodeEntity);
//        }
//
//        // 3. Link 엔티티 리스트 및 하위 요소(Lane, Cell, Segment) 생성
//        for (LinkXmlResponse linkDto : networkDto.getLinks()) {
//            Link linkEntity = linkMapper.xmlToEntity(linkDto, networkEntity);
//
//            if (linkDto.getLanes() != null) {
//                for (LaneXmlResponse laneDto : linkDto.getLanes()) {
//                    Lane laneEntity = laneMapper.xmlToEntity(laneDto, linkEntity);
//
//                    // Lane의 하위 요소들 매핑
//                    List<Cell> cellEntities = cellMapper.xmlToEntities(laneDto.getCells(), laneEntity);
//                    cellEntities.forEach(laneEntity::addCell);
//
//                    List<Segment> segmentEntities = segmentMapper.xmlToEntities(laneDto.getSegments(), laneEntity);
//                    segmentEntities.forEach(laneEntity::addSegment);
//
//                    linkEntity.addLane(laneEntity);
//                }
//            }
//            networkEntity.addLink(linkEntity);
//        }
//
//        // 4. DB에 Network와 모든 하위 요소를 한번에 저장 (ID 생성 목적)
//        networkRepository.saveAndFlush(networkEntity);
//
//        // 5. Connection 처리를 위해 Link와 Lane을 Map으로 만들어 빠른 조회 지원
//        Map<Long, Link> linkMap = networkEntity.getLinks().stream()
//                .collect(Collectors.toMap(Link::getId, Function.identity()));
//
//        Map<String, Lane> laneMap = networkEntity.getLinks().stream()
//                .flatMap(link -> link.getLanes().stream())
//                .collect(Collectors.toMap(lane -> lane.getLink().getId() + "_" + lane.getId(), Function.identity()));
//
//        // 6. Node를 다시 순회하며 Port와 Connection 관계 설정
//        for (int i = 0; i < networkEntity.getNodes().size(); i++) {
//            Node nodeEntity = networkEntity.getNodes().get(i);
//            NodeXmlResponse nodeDto = networkDto.getNodes().get(i);
//
//            // Port 추가
//            List<Port> portEntities = portMapper.xmlToEntities(nodeDto.getPorts(), nodeEntity);
//            portEntities.forEach(nodeEntity::addPort);
//
//            // Connection 추가 (ID 기반 조회 및 관계 설정)
//            if (nodeDto.getConnections() != null) {
//                for (ConnectionXmlResponse connDto : nodeDto.getConnections()) {
//                    Link fromLink = linkMap.get(connDto.getFromLink());
//                    Lane fromLane = laneMap.get(connDto.getFromLink() + "_" + connDto.getFromLane());
//                    Link toLink = linkMap.get(connDto.getToLink());
//                    Lane toLane = laneMap.get(connDto.getToLink() + "_" + connDto.getToLane());
//
//                    if(fromLink == null || fromLane == null || toLink == null || toLane == null) {
//                        continue;
//                    }
//
//                    Connection connection = Connection.builder()
//                            .id(connDto.getId())
//                            .fromLink(fromLink.getId())
//                            .fromLane(fromLane.getId())
//                            .toLink(toLink.getId())
//                            .toLane(toLane.getId())
//                            .turning(connDto.getTurning())
//                            .length(connDto.getLength())
//                            .width(connDto.getWidth())
//                            .ffSpd(connDto.getFfSpd())
//                            .shape(connDto.getShape())
//                            .build();
//
//                    nodeEntity.addConnection(connection);
//                }
//            }
//        }
//
//        // 7. 모든 관계가 완전히 설정된 Network를 최종 저장 (Update)
//        return networkRepository.save(networkEntity);
//    }
//
//
//
//    /**
//     * 1) Node/Link/Lane의 shape 문자열 → 좌표 변환
//     * 2) 변환 완료 후, 각 Node의 connection에 대해 from/to lane 앵커 좌표를 채움
//     * <p>
//     * 1) Convert shapes to coordinates for Node/Link/Lane
//     * 2) After conversion, populate from/to lane anchor coordinates for each Node's connections
//     */
//    public NetworkXmlResponse transformNetworkCoordinates(String key, NetworkXmlResponse dto) {
//        // 1. 기준점 및 스케일 준비 / Prepare base point & scale
//        Scenario scenario = scenarioRepository.findByKey(key).orElse(new Scenario());
//        double baseLatitude = scenario.getLatitude();
//        double baseLongitude = scenario.getLongitude();
//
//        // 2. Nodes & Connections: node.center / connection.shape → coordinates
//        dto.getNodes().forEach(node -> {
//            List<Coordinates> transformedNodeCoords = CoordinateUtils.parseAndTransform(
//                    node.getCenter(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
//            );
//            if (!transformedNodeCoords.isEmpty()) {
//                node.setCoordinates(transformedNodeCoords.getFirst());
//            }
//
//            node.getConnections().forEach(connection ->
//                    connection.setCoordinates(CoordinateUtils.parseAndTransform(
//                            connection.getShape(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
//                    ))
//            );
//        });
//
//        // 3. Links & Lanes: link.shape / lane.shape → coordinates
//        dto.getLinks().forEach(link -> {
//            link.setCoordinates(CoordinateUtils.parseAndTransform(
//                    link.getShape(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
//            ));
//            link.getLanes().forEach(lane ->
//                    lane.setCoordinates(CoordinateUtils.parseAndTransform(
//                            lane.getShape(), baseLongitude, baseLatitude, SCALE_X, SCALE_Y
//                    ))
//            );
//        });
//
//        // 4. 각 connection에 from/to lane의 "노드측 1개 점"을 채움
//        //    Populate node-side single anchor point for from/to lane of each connection
//        populateConnectionLaneAnchors(dto);
//
//        return dto;
//    }
//
//    /**
//     * 각 Node의 connection에 대해,
//     * - fromLaneCoordinates: from_link의 해당 lane에서 노드측 끝점 1개
//     * - toLaneCoordinates:   to_link의 해당 lane에서 노드측 시작점 1개
//     * <p>
//     * For every Node's connection:
//     * - fromLaneCoordinates: 1 node-side endpoint from the lane of from_link
//     * - toLaneCoordinates:   1 node-side startpoint from the lane of to_link
//     */
//    private void populateConnectionLaneAnchors(NetworkXmlResponse dto) {
//        if (dto == null || dto.getLinks() == null || dto.getNodes() == null) return;
//
//        // Build link index: id → LinkData
//        Map<Long, LinkXmlResponse> linkById = dto.getLinks().stream()
//                .filter(Objects::nonNull)
//                .collect(Collectors.toMap(LinkXmlResponse::getId, Function.identity(), (a, b) -> a));
//
//        for (NodeXmlResponse node : dto.getNodes()) {
//            Long nodeId = node.getId();
//            if (nodeId == null) {
//                log.warn("[populateConnectionLaneAnchors] Node id is null or not a number: {}", node.getId());
//                continue;
//            }
//            if (node.getConnections() == null) continue;
//
//            for (ConnectionXmlResponse conn : node.getConnections()) {
//                // Lookup from/to links
//                Long fromLinkId = conn.getFromLink();
//                Long toLinkId = conn.getToLink();
//                LinkXmlResponse fromLink = fromLinkId != null ? linkById.get(fromLinkId) : null;
//                LinkXmlResponse toLink = toLinkId != null ? linkById.get(toLinkId) : null;
//
//                // Prepare result lists (single point each)
//                Coordinates fromLaneAnchor = new Coordinates();
//                Coordinates toLaneAnchor = new Coordinates();
//
//                // --- from side ---
//                if (fromLink != null) {
//                    LaneXmlResponse fromLane = findLane(fromLink, conn.getFromLane());
//                    if (fromLane != null && isNonEmpty(fromLane.getCoordinates())) {
//                        // 노드가 link.toNode이면 incoming → 마지막 점 / if node==toNode => incoming → last point
//                        // 노드가 link.fromNode이면 outgoing → 첫 점 / if node==fromNode => outgoing → first point
//                        boolean nodeIsTo = Objects.equals(fromLink.getToNode(), nodeId);
//                        Coordinates anchor = nodeIsTo
//                                ? last(fromLane.getCoordinates())
//                                : first(fromLane.getCoordinates());
//                        fromLaneAnchor = anchor;
//                    } else {
//                        log.warn("[populateConnectionLaneAnchors] Missing fromLane or coordinates: node={}, connId={}, fromLink={}, fromLane={}",
//                                node.getId(), conn.getId(), conn.getFromLink(), conn.getFromLane());
//                    }
//                } else {
//                    log.warn("[populateConnectionLaneAnchors] Missing fromLink: node={}, connId={}, fromLink={}",
//                            node.getId(), conn.getId(), conn.getFromLink());
//                }
//
//                // --- to side ---
//                if (toLink != null) {
//                    LaneXmlResponse toLane = findLane(toLink, conn.getToLane());
//                    if (toLane != null && isNonEmpty(toLane.getCoordinates())) {
//                        // 노드가 link.fromNode이면 outgoing 시작점 → 첫 점 / if node==fromNode => outgoing start → first point
//                        // 노드가 link.toNode이면 incoming 말단 → 마지막 점 / if node==toNode => incoming end → last point
//                        boolean nodeIsFrom = Objects.equals(toLink.getFromNode(), nodeId);
//                        Coordinates anchor = nodeIsFrom
//                                ? first(toLane.getCoordinates())
//                                : last(toLane.getCoordinates());
//                        toLaneAnchor = anchor;
//                    } else {
//                        log.warn("[populateConnectionLaneAnchors] Missing toLane or coordinates: node={}, connId={}, toLink={}, toLane={}",
//                                node.getId(), conn.getId(), conn.getToLink(), conn.getToLane());
//                    }
//                } else {
//                    log.warn("[populateConnectionLaneAnchors] Missing toLink: node={}, connId={}, toLink={}",
//                            node.getId(), conn.getId(), conn.getToLink());
//                }
//
//                // Apply
//                conn.setFromLaneCoordinates(fromLaneAnchor);
//                conn.setToLaneCoordinates(toLaneAnchor);
//            }
//        }
//    }
//
//
//    private static boolean isNonEmpty(List<?> list) {
//        return list != null && !list.isEmpty();
//    }
//
//    /**
//     * lane.id(문자열) == 요청 인덱스(정수)의 문자열 매칭을 우선,
//     * 실패 시 0-based 인덱스 접근을 fallback 으로 사용.
//     * <p>
//     * Prefer lane.id(String) == index(String) matching, fallback to 0-based index.
//     */
//    private static LaneXmlResponse findLane(LinkXmlResponse link, Long laneIndex) {
//        if (link == null || link.getLanes() == null) return null;
//
//        String want = String.valueOf(laneIndex);
//        for (LaneXmlResponse lane : link.getLanes()) {
//            if (lane != null && want.equals(lane.getId())) {
//                return lane;
//            }
//        }
//        // fallback by 0-based index
//        List<LaneXmlResponse> lanes = link.getLanes();
//        if (laneIndex >= 0 && laneIndex < lanes.size()) {
//            return lanes.get(Math.toIntExact(laneIndex));
//        }
//        return null;
//    }
//
//    private static Coordinates first(List<Coordinates> list) {
//        return list.get(0);
//    }
//
//    private static Coordinates last(List<Coordinates> list) {
//        return list.get(list.size() - 1);
//    }


