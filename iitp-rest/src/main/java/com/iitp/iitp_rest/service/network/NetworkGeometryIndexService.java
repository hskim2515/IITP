package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.LaneGeometryUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 버전(versionId)별 network.xml의 link/lane/connection 도형을 로컬 좌표(원본 shape, WGS84 변환
 * 전) 그대로 인메모리 캐싱해, 차량 CZML geometry 투영({@code VehicleController})이 매 요청마다
 * network.xml을 재파싱하지 않고 link_id/node_id로 바로 조회하게 한다.
 *
 * <p>{@link NetworkService#getNetworkXmlByVersionId}가 아니라 {@link NetworkService#getRawXmlBytes}
 * 를 쓰는 이유: 전자는 {@code transformNetworkCoordinates}가 shape를 WGS84로 변환해 버려 vehicle
 * 이벤트(pos_x/pos_y, 로컬 좌표)와 좌표계가 안 맞는다.
 *
 * <p>network.xml은 버전당 수백KB~1MB 남짓(scenario3_1_V2 기준 552KB, 링크 330/커넥션 838/노드
 * 253)이라 버전별 전체 인메모리 캐싱이 충분히 가능한 크기 — SQLite 타일링(NetworkTileService)
 * 수준의 인프라는 불필요.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkGeometryIndexService {

    private final NetworkService networkService;
    private final NetworkJaxbParser networkJaxbParser;

    private final ConcurrentHashMap<String, GeometryIndex> cache = new ConcurrentHashMap<>();

    public GeometryIndex get(String versionId) throws IOException {
        GeometryIndex existing = cache.get(versionId);
        if (existing != null) return existing;
        synchronized (this) {
            existing = cache.get(versionId);
            if (existing != null) return existing;
            byte[] xmlBytes = networkService.getRawXmlBytes(versionId);
            NetworkXml network = networkJaxbParser.parse(new ByteArrayInputStream(xmlBytes));
            GeometryIndex built = new GeometryIndex(network);
            cache.put(versionId, built);
            log.info("[NetworkGeometryIndexService] {} geometry index 빌드 완료 (link {}, node {})",
                    versionId, built.linksById.size(), built.nodesById.size());
            return built;
        }
    }

    /** network.xml 재저장(diff-save/full-save/OSM import 등) 시점에 {@code NetworkTileService}의
     *  캐시와 함께 호출해야 한다 — 같은 versionId에 대해 낡은 geometry가 계속 쓰이는 것을 방지. */
    public void invalidate(String versionId) {
        cache.remove(versionId);
    }

    public static final class GeometryIndex {
        // NetworkIdAssigner/NetworkIdNormalizer의 id 범위 관례:
        // [20,000,000, 30,000,000) = LinkXml.id, [10,000,000, 20,000,000) = NodeXml.id(교차로 등)
        private static final long NODE_ID_MIN = 10_000_000L;
        private static final long NODE_ID_MAX = 20_000_000L;
        private static final long LINK_ID_MIN = 20_000_000L;
        private static final long LINK_ID_MAX = 30_000_000L;

        private final Map<Long, LinkXml> linksById;
        private final Map<Long, NodeXml> nodesById;
        private final Map<Long, Map<Integer, List<Coordinates>>> laneCenterlineCache = new ConcurrentHashMap<>();
        private final Map<Long, Map<Long, List<Coordinates>>> connectionShapeCache = new ConcurrentHashMap<>();

        /** 테스트 전용 — SFTP를 거치지 않고 이미 파싱된(로컬 shape 그대로인) NetworkXml로 바로
         *  인덱스를 만든다(VehicleControllerGeometryProjectionTest가 controller 패키지에서
         *  호출하므로 public). */
        public static GeometryIndex forTesting(NetworkXml network) {
            return new GeometryIndex(network);
        }

        private GeometryIndex(NetworkXml network) {
            Map<Long, LinkXml> links = new HashMap<>();
            if (network.getLinks() != null) {
                for (LinkXml l : network.getLinks()) {
                    if (l.getId() != null) links.put(l.getId(), l);
                }
            }
            Map<Long, NodeXml> nodes = new HashMap<>();
            if (network.getNodes() != null) {
                for (NodeXml n : network.getNodes()) {
                    if (n.getId() != null) nodes.put(n.getId(), n);
                }
            }
            this.linksById = links;
            this.nodesById = nodes;
        }

        public static boolean isNodeRange(long id) {
            return id >= NODE_ID_MIN && id < NODE_ID_MAX;
        }

        public static boolean isLinkRange(long id) {
            return id >= LINK_ID_MIN && id < LINK_ID_MAX;
        }

        public LinkXml link(long linkId) {
            return linksById.get(linkId);
        }

        public NodeXml node(long nodeId) {
            return nodesById.get(nodeId);
        }

        /** VehicleEvent가 커넥션(노드) 위에 있을 때: link_id=노드 id, lane_id=그 노드
         *  {@code NodeXml.connections} 안에서의 local {@link ConnectionXml#getId()}. */
        public ConnectionXml connection(long nodeId, long localConnId) {
            NodeXml node = nodesById.get(nodeId);
            if (node == null || node.getConnections() == null) return null;
            for (ConnectionXml c : node.getConnections()) {
                if (c.getId() != null && c.getId() == localConnId) return c;
            }
            return null;
        }

        /** link.shape+width+laneIdx로 재구성한 레인 중심선(로컬 좌표) — 지연 계산 후 캐싱. */
        public List<Coordinates> laneCenterline(long linkId, int laneIdx) {
            LinkXml link = linksById.get(linkId);
            if (link == null) return null;
            Map<Integer, List<Coordinates>> perLink =
                    laneCenterlineCache.computeIfAbsent(linkId, k -> new ConcurrentHashMap<>());
            return perLink.computeIfAbsent(laneIdx, idx -> LaneGeometryUtils.computeLaneCenterline(link, idx));
        }

        /** connection.shape 그대로(로컬 좌표) — 지연 파싱 후 캐싱. */
        public List<Coordinates> connectionCurve(long nodeId, long localConnId) {
            Map<Long, List<Coordinates>> perNode =
                    connectionShapeCache.computeIfAbsent(nodeId, k -> new ConcurrentHashMap<>());
            return perNode.computeIfAbsent(localConnId, id -> {
                ConnectionXml conn = connection(nodeId, id);
                if (conn == null || conn.getShape() == null) return null;
                List<Coordinates> parsed = CoordinateUtils.parse(conn.getShape());
                return parsed.size() >= 2 ? parsed : null;
            });
        }

        /** 주어진 구간(링크 또는 노드 위 커넥션)의 물리적 속도 상한(m/s). 조회 실패 시 null —
         *  호출측은 하드 폴백 상수를 써야 한다. */
        public Double segmentMaxSpeedMps(long linkOrNodeId, int laneOrConnId) {
            if (isLinkRange(linkOrNodeId)) {
                LinkXml link = linksById.get(linkOrNodeId);
                return (link != null && link.getMaxSpd() > 0) ? link.getMaxSpd() / 3.6 : null;
            }
            if (isNodeRange(linkOrNodeId)) {
                ConnectionXml conn = connection(linkOrNodeId, laneOrConnId);
                return (conn != null && conn.getFfSpd() > 0) ? conn.getFfSpd() / 3.6 : null;
            }
            return null;
        }
    }
}
