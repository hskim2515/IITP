package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.osm.OsmNode;
import com.iitp.iitp_rest.model.osm.OsmWay;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import com.iitp.iitp_rest.model.publicTransit.bus.BusLineResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.ExitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * OSM 시설물 데이터 → 도메인 Response 변환.
 *
 * 버스정류장: highway=bus_stop → BusStationResponse (link_ref 스냅)
 * 철도역:    railway=station/halt → RailStationResponse
 * 버스노선:  relation route=bus → BusPtLines (Lines XML 구조)
 * 철도노선:  relation route=subway/train → RailPtLine
 */
@Slf4j
@Service
public class OsmFacilityConverter {

    private static final double SCALE_X = 88000.0;
    private static final double SCALE_Y = 111000.0;
    private static final double MAX_SNAP_DIST_M = 50.0; // 링크 스냅 최대 거리(m)
    private static final double GRID_CELL_M = 100.0; // 링크 공간 그리드 셀 크기(m)
    /** OSM에는 배차간격 정보가 없어 변환된 모든 버스 노선에 일괄로 채우는 기본값(분) */
    private static final int DEFAULT_BUS_INTERVAL_MIN = 10;

    /** 버스/철도 시설물 자동생성 옵션 — null 필드는 기본값(둘 다 생성, 배차간격
     *  {@link #DEFAULT_BUS_INTERVAL_MIN}분) 사용. 프론트 앱 설정(⚙ → 자동생성 설정)에서
     *  사용자가 조정해 KTDB 임포트 요청에 실어 보낸다. */
    public record FacilityGenerationOptions(Boolean includeBus, Boolean includeRail, Integer busDefaultIntervalMin) {
        public static final FacilityGenerationOptions DEFAULT = new FacilityGenerationOptions(null, null, null);
    }

    public record FacilityResult(
        PublicTransitResponse busStations,
        RailPublicTransitResponse railStations,
        Map<String, Object> busRoutes,
        Map<String, Object> railRoutes
    ) {}

    // OSM 노드 WGS84 캐시 (id → [lon, lat])
    private final Map<Long, double[]> osmNodeWgs84 = new LinkedHashMap<>();
    // OSM 노드 원본(태그 포함) 캐시 — route relation의 "stop" role 멤버가 name으로 실제 역과
    // 매칭되는지 확인하는 데 필요(railway=stop 노드는 railway=station 노드와 별개다)
    private final Map<Long, OsmNode> osmNodeById = new LinkedHashMap<>();
    // OSM way 캐시 (wayId → nodeIds 순서)
    private final Map<Long, List<Long>> osmWayNodes = new LinkedHashMap<>();
    // 링크 공간 그리드 인덱스(그리드 셀 키 → 그 셀에 걸치는 링크 목록) — snapToLink 전용.
    // ⚠️ 실측 성능 문제: 버스 노선이 많은 지역(강남 일대, 링크 1567개 × 노선 좌표점 약 2만개)에서
    // 링크 전수 스캔 스냅이 초 단위가 아니라 수십 초까지 걸렸다(O(점 수 × 링크 수)). 링크를
    // 100m 그리드에 미리 인덱싱해두고 점 주변 3x3 셀의 링크만 검사하도록 바꿔 후보 수를
    // 몇 개~몇십 개로 줄인다.
    private final Map<Long, List<LinkXml>> linkGrid = new HashMap<>();
    // 링크 shape 파싱 결과 캐시 — 같은 링크가 여러 그리드 셀/여러 쿼리 점의 후보로 반복
    // 등장하므로 parseShape() 재파싱을 피한다.
    private final Map<Long, List<double[]>> linkShapeCache = new HashMap<>();
    // 링크 위상(from_node/to_node) 인덱스 — snapRouteToLinks가 "이전에 스냅된 링크의
    // to_node에서 출발하는 링크"를 다음 스냅 후보로 우선시하는 데 쓴다(아래 snapToLink 참고).
    private final Map<Long, LinkXml> linkById = new HashMap<>();
    private final Map<Long, List<LinkXml>> outLinksByNode = new HashMap<>();
    private final Map<Long, List<LinkXml>> inLinksByNode = new HashMap<>();
    // 터미널(type="terminal") 노드 id 집합 — convertBusRoutes가 노선 양끝을 터미널까지
    // 연장하는 데 사용(아래 extendToTerminal 참고).
    private final Set<Long> terminalNodeIds = new HashSet<>();

    /**
     * @param facilities Overpass에서 조회한 시설물 원시 데이터
     * @param networkXml 이미 변환된 네트워크 (link_ref 스냅에 사용)
     * @param baseLat    로컬 좌표 원점 위도
     * @param baseLon    로컬 좌표 원점 경도
     */
    public FacilityResult convert(
            OsmOverpassService.FacilityQueryResult facilities,
            NetworkXml networkXml,
            double baseLat, double baseLon) {
        return convert(facilities, networkXml, baseLat, baseLon, null);
    }

    public FacilityResult convert(
            OsmOverpassService.FacilityQueryResult facilities,
            NetworkXml networkXml,
            double baseLat, double baseLon,
            double[] bbox) { // [south, west, north, east] or null
        return convert(facilities, networkXml, baseLat, baseLon, bbox, FacilityGenerationOptions.DEFAULT);
    }

    public FacilityResult convert(
            OsmOverpassService.FacilityQueryResult facilities,
            NetworkXml networkXml,
            double baseLat, double baseLon,
            double[] bbox, // [south, west, north, east] or null
            FacilityGenerationOptions options) {
        boolean includeBus = options == null || options.includeBus() == null || options.includeBus();
        boolean includeRail = options == null || options.includeRail() == null || options.includeRail();
        int busIntervalMin = options != null && options.busDefaultIntervalMin() != null
                ? options.busDefaultIntervalMin() : DEFAULT_BUS_INTERVAL_MIN;

        List<LinkXml> links = networkXml.getLinks() != null ? networkXml.getLinks() : List.of();
        buildLinkGrid(links);

        terminalNodeIds.clear();
        if (networkXml.getNodes() != null) {
            for (NodeXml n : networkXml.getNodes()) {
                if (n.getType() == NodeType.Terminal && n.getId() != null) terminalNodeIds.add(n.getId());
            }
        }

        // 전체 노드/way 캐시 구성
        osmNodeWgs84.clear();
        osmNodeById.clear();
        osmWayNodes.clear();
        for (OsmNode n : facilities.allNodes()) {
            osmNodeWgs84.put(n.getId(), new double[]{n.getLon(), n.getLat()});
            osmNodeById.put(n.getId(), n);
        }
        for (OsmWay w : facilities.allWays())
            osmWayNodes.put(w.getId(), w.getNodeIds());

        PublicTransitResponse busStations;
        Map<String, Object> busRoutes;
        if (includeBus) {
            busStations = convertBusStops(facilities.busStops(), links, baseLat, baseLon);
            busRoutes = convertBusRoutes(
                    facilities.busRoutes(), bbox, links, baseLat, baseLon, busStations.getBusStations(), busIntervalMin);
        } else {
            busStations = new PublicTransitResponse();
            busStations.setBusStations(List.of());
            busRoutes = Map.of("lines", List.of());
        }

        RailPublicTransitResponse railStations;
        Map<String, Object> railRoutes;
        if (includeRail) {
            // OSM 노드 id → 우리가 새로 부여한 역 id (철도 노선의 railStationSeq 구성에 필요 —
            // OSM route relation의 member node가 어느 역인지는 원본 OSM id로만 식별 가능하다)
            Map<Long, String> railStationIdByOsmNode = new LinkedHashMap<>();
            // 역 이름 → 역 id — route relation의 "stop" role 멤버는 railway=stop 태그의 별도
            // 노드라 railStationIdByOsmNode에 없다(실측: 강남역 인근 2호선 relation으로 확인).
            // 두 노드 모두 보통 동일한 name 태그를 갖고 있어 이름으로 재매칭한다.
            Map<String, String> railStationIdByName = new LinkedHashMap<>();
            railStations = convertRailStations(
                    facilities.railStations(), links, baseLat, baseLon, railStationIdByOsmNode, railStationIdByName);
            railRoutes = convertRailRoutes(
                    facilities.railRoutes(), bbox, railStationIdByOsmNode, railStationIdByName);
        } else {
            railStations = new RailPublicTransitResponse();
            railStations.setRailStations(List.of());
            railRoutes = Map.of("routes", List.of());
        }

        return new FacilityResult(busStations, railStations, busRoutes, railRoutes);
    }

    // ── 버스 정류장 ───────────────────────────────────────────────────────────

    private PublicTransitResponse convertBusStops(
            List<OsmNode> stops, List<LinkXml> links, double baseLat, double baseLon) {

        AtomicLong idGen = new AtomicLong(30000001L);
        List<BusStationResponse> result = new ArrayList<>();

        for (OsmNode stop : stops) {
            double lx = (stop.getLon() - baseLon) * SCALE_X;
            double ly = (stop.getLat() - baseLat) * SCALE_Y;

            SnapResult snap = snapToLink(lx, ly);
            // ⚠️ 실측 크래시: NextSim RouteGenerator는 <station> 엘리먼트에 link_ref가
            // 없으면 "Element should have 'link_ref' attribute" 예외를 던지며 죽는다(터미널
            // 조합과 무관하게 항상 재현 — 크래시 복구 이분탐색이 절대 수렴하지 못하는 원인이었음).
            // 철도역(convertRailStations)은 Exit 서브엘리먼트가 없으면 그만이라 스냅 실패해도
            // 역 자체는 표시 가능하지만, 버스정류장은 link_ref가 station 태그 자체의 필수
            // 속성이라 스냅 실패 시 아예 제외해야 한다(50m 밖 정류장은 네트워크에 없는 것으로 간주).
            if (snap == null) continue;

            BusStationResponse station = new BusStationResponse();
            station.setId(String.valueOf(idGen.getAndIncrement()));
            station.setTransitMode(TransitMode.bus);
            station.setCenter(fmt3(lx) + " " + fmt3(ly));
            station.setType(StationType.side);
            station.setLinkRef(snap.linkId());
            station.setLaneRef((long) snap.laneId());
            station.setOffset(round2(snap.offset()));

            String name = stop.getTag("name");
            if (name != null) station.setAddress(name);

            BusLineResponse line = new BusLineResponse();
            line.setList("");
            station.setLine(line);

            result.add(station);
        }

        PublicTransitResponse resp = new PublicTransitResponse();
        resp.setBusStations(result);
        log.info("버스 정류장 변환: {}개", result.size());
        return resp;
    }

    // ── 철도 역 ────────────────────────────────────────────────────────────────

    private RailPublicTransitResponse convertRailStations(
            List<OsmNode> stations, List<LinkXml> links, double baseLat, double baseLon,
            Map<Long, String> railStationIdByOsmNode, Map<String, String> railStationIdByName) {

        AtomicLong idGen = new AtomicLong(31000001L);
        List<RailStationResponse> result = new ArrayList<>();

        for (OsmNode st : stations) {
            double lx = (st.getLon() - baseLon) * SCALE_X;
            double ly = (st.getLat() - baseLat) * SCALE_Y;

            SnapResult snap = snapToLink(lx, ly);

            RailStationResponse station = new RailStationResponse();
            station.setId(String.valueOf(idGen.getAndIncrement()));
            railStationIdByOsmNode.put(st.getId(), station.getId());
            station.setTransitMode(TransitMode.subway);
            station.setCenter(fmt3(lx) + " " + fmt3(ly));
            station.setType(StationType.island);
            station.setLineList("");

            // WGS84 coordinates 설정 → 레이어에서 직접 표시 가능
            com.iitp.iitp_rest.model.geometry.Coordinates coords = new com.iitp.iitp_rest.model.geometry.Coordinates();
            coords.setLng(st.getLon());
            coords.setLat(st.getLat());
            station.setCoordinates(coords);

            String name = st.getTag("name");
            if (name != null) {
                station.setAddress(name);
                railStationIdByName.putIfAbsent(name, station.getId());
            }

            // 출입구: 링크 스냅이 있으면 exit 생성, 없어도 역 자체는 표시
            if (snap != null) {
                ExitResponse exit = new ExitResponse();
                // ⚠️ 실측 크래시: idGen.get()은 카운터를 소비하지 않고 "다음 값을 훔쳐보기만"
                // 해서, 바로 다음 루프의 station.setId()가 같은 값을 또 쓰게 돼 station id와
                // exit id가 충돌했다(실측: railStation.xml의 exit 85개 전부가 다른 역의 id와
                // 겹침). NextSim RouteGenerator의 PT Route Generation 단계가 이 id를 키로
                // 맵을 구성하는데, 충돌로 항목이 덮어써지며 std::out_of_range(_Map_base::at)로
                // 크래시했다(scenario2_1, 터미널 조합과 무관하게 항상 재현). getAndIncrement()로
                // 고유 id를 소비하도록 수정.
                exit.setId(String.valueOf(idGen.getAndIncrement()));
                exit.setLinkRef(String.valueOf(snap.linkId()));
                exit.setOffset(round2(snap.offset()));
                exit.setAccessTime("30");
                exit.setCoord(fmt3(lx) + " " + fmt3(ly));
                station.setExits(List.of(exit));
            } else {
                station.setExits(List.of());
            }

            result.add(station);
        }

        RailPublicTransitResponse resp = new RailPublicTransitResponse();
        resp.setRailStations(result);
        log.info("철도역 변환: {}개", result.size());
        return resp;
    }

    // ── 버스 노선 ─────────────────────────────────────────────────────────────

    /**
     * BusPtLinesXml 포맷 + coords 배열 (OSM 정류장 좌표 직접 포함)
     *
     * <p>⚠️ 실측 확인(강남역 인근 서울 버스 140번 relation): 한국 OSM 버스 노선 relation은
     * member가 전부 way(도로 구간)이고 정류장 node는 아예 포함하지 않는다(철도처럼 "stop" role
     * 멤버가 없음) — 그래서 station.seq는 멤버 매칭이 아니라 이미 변환된 busStations 중
     * **이 노선의 link.seq에 실제로 스냅된(link_ref가 일치하는) 정류장만** 골라 그 위치 순서로
     * 정렬해 구성한다.
     *
     * <p>⚠️ 실측 반영(사용자 지적): 같은 도로라도 왕복 방향이 별도 링크로 분리돼 있는 경우가
     * 많아, 단순 최근접 스냅은 반대 방향 링크를 잘못 고를 수 있다. way 순서가 실제 진행
     * 방향이므로, 각 구간의 진행 방향 벡터와 후보 링크 세그먼트의 방향을 비교해(내적<=0이면
     * 제외) 방향이 맞는 링크만 스냅한다({@link #snapToLink(double, double, double[])}).
     */
    private Map<String, Object> convertBusRoutes(
            List<OsmOverpassService.OsmRelation> routes, double[] bbox,
            List<LinkXml> links, double baseLat, double baseLon,
            List<BusStationResponse> busStations, int defaultIntervalMin) {
        List<Map<String, Object>> lines = new ArrayList<>();
        Map<String, BusStationResponse> stationById = new HashMap<>();
        for (BusStationResponse st : busStations) stationById.put(st.getId(), st);
        int idSeq = 1;
        for (OsmOverpassService.OsmRelation rel : routes) {
            String name   = rel.getTag("name");
            String ref    = rel.getTag("ref");
            // ⚠️ 실측 크래시: ref(버스 노선 번호, 예: "9202")를 id로 썼더니 같은 번호를 공유하는
            // 상행/하행 등 별도 relation이 <Line id="9202">를 중복 생성했다(실측: roadPTline.xml
            // 67개 Line 중 13개 id 중복). NextSim RouteGenerator의 PT Route Generation이 이 id를
            // 키로 맵을 구성하는데 중복 삽입으로 std::out_of_range(_Map_base::at) 크래시가 났다
            // (scenario2_1, 터미널 조합과 무관하게 항상 재현). id는 항상 고유한 순번만 쓰고,
            // 사람이 읽는 노선 번호는 name(비어있으면 ref)으로만 노출한다.
            String lineId = String.valueOf(idSeq);

            // way 노드 순서를 따라 실제 도로 형상 좌표 수집 (bbox 내부만, gap은 null 구분자)
            List<Map<String, Double>> coords = buildRouteCoords(rel.memberWayIds(), bbox);

            // way가 없거나 좌표 수집 실패 시 stop 노드 순서로 fallback
            if (coords.isEmpty()) {
                for (Long nodeId : rel.memberNodeIds()) {
                    double[] wgs = osmNodeWgs84.get(nodeId);
                    if (wgs == null) continue;
                    if (bbox != null) {
                        boolean inBbox = wgs[1] >= bbox[0] && wgs[1] <= bbox[2]
                                      && wgs[0] >= bbox[1] && wgs[0] <= bbox[3];
                        if (!inBbox) continue;
                    }
                    Map<String, Double> pt = new LinkedHashMap<>();
                    pt.put("lng", wgs[0]);
                    pt.put("lat", wgs[1]);
                    coords.add(pt);
                }
            }

            // ⚠️ 실측 확인: extendToTerminal의 BFS 연장 구간이 원래 노선이 이미 지나온 링크를
            // 다시 통과하는 경로를 고르는 경우가 있어(scenario2_1 노선 37/42/51/79) 중복이
            // 재발생했다 — 연장 후에도 다시 한번 루프 제거를 적용해야 한다.
            List<Long> linkSeq = removeDuplicateLinkLoops(
                    extendToTerminal(snapRouteToLinks(coords, links, baseLat, baseLon)));
            // 안전장치: BFS로도 터미널에 못 닿으면(고립된 서브그래프 등) 이 노선은 NextSim에서
            // 항상 크래시하므로 아예 제외한다 — 빈 노선이 아니라 "만들 수 없는" 노선으로 취급.
            if (!linkSeq.isEmpty() && !touchesTerminalAtBothEnds(linkSeq)) continue;
            List<String> stationSeq = orderStationsAlongRoute(linkSeq, busStations);
            // ⚠️ 실측 크래시: 정류장이 하나도 안 걸린 노선(station.seq 빈 문자열)을 그대로
            // 두면 nextsim 시뮬레이션 시작 직전 "Cannot build OD map for line N. RoadLinks or
            // RoadStations is empty."로 SIGSEGV 크래시한다(scenario2_1 실측, 142개 노선 중
            // 9개가 원인). 정류장 없는 버스노선은 대중교통 시뮬레이션에 의미가 없기도 하므로
            // 터미널 미도달 노선과 동일하게 제외한다.
            if (stationSeq.isEmpty()) continue;
            // ⚠️ 실측 크래시 후보: 레퍼런스 데이터(network_xml_bucheon/roadStation.xml)를 보면
            // <station>의 line.list가 자신을 지나는 노선 id를 역으로 나열한다(양방향 참조) —
            // roadPTline.xml의 station.seq → station id 방향 참조만 만들고 이 역방향은 항상
            // 빈 문자열로 뒀었다. NextSim이 station.line.list로 노선을 찾는 경로가 있다면
            // 이 누락도 PT Route Generation std::out_of_range의 원인일 수 있다.
            for (String stId : stationSeq) {
                BusStationResponse st = stationById.get(stId);
                if (st == null || st.getLine() == null) continue;
                String existing = st.getLine().getList();
                st.getLine().setList(existing == null || existing.isBlank() ? lineId : existing + " " + lineId);
            }

            Map<String, Object> line = new LinkedHashMap<>();
            line.put("id",       lineId);
            line.put("name",     name != null ? name : (ref != null ? ref : lineId));
            line.put("interval", defaultIntervalMin);
            line.put("coords",   coords);
            line.put("link",     Map.of("seq", linkSeq.stream().map(String::valueOf).reduce((a,b) -> a + " " + b).orElse("")));
            // ⚠️ 실측 크래시: node.seq를 항상 빈 문자열로 뒀더니 NextSim RouteGenerator의 PT
            // Route Generation이 std::out_of_range(_Map_base::at)로 죽었다(scenario2_1, 터미널
            // 조합과 무관하게 항상 재현). 실제 KAIST 검증 데이터(network_xml_bucheon/roadPTline.xml)
            // 확인 결과 node.seq는 항상 링크 개수+1개의 노드 체인(from_node → to_node → ... →
            // 마지막 to_node)으로 채워져 있어야 하는 필수 필드였다.
            line.put("node",     Map.of("seq", buildNodeSeq(linkSeq)));
            line.put("station",  Map.of("seq", String.join(" ", stationSeq)));
            line.put("garage",   Map.of("seq", ""));

            lines.add(line);
            idSeq++;
        }
        log.info("버스 노선 변환: {}개 (coords 포함)", lines.size());
        return Map.of("lines", lines);
    }

    /** link.seq(연속 링크 체인)로부터 node.seq(from_node → to_node → ... 노드 체인, 링크
     *  개수+1개)를 만든다. 링크 위상 연속성은 이미 {@link #snapRouteToLinks}가 보장한다. */
    private String buildNodeSeq(List<Long> linkSeq) {
        if (linkSeq.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        LinkXml first = linkById.get(linkSeq.get(0));
        if (first != null && first.getFromNode() != null) {
            sb.append(first.getFromNode());
        }
        for (Long linkId : linkSeq) {
            LinkXml link = linkById.get(linkId);
            if (link == null || link.getToNode() == null) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(link.getToNode());
        }
        return sb.toString();
    }

    // ── 기존 버스 노선 재매핑(KTDB 재임포트로 link/node id가 낡아진 경우) ────────────
    // 재임포트 후엔 옛 network.xml(옛 링크 shape)이 이미 사라져 노선 좌표를 그대로 재사용할
    // 수 없다 — 대신 그 노선이 지나는 정류장들(station.seq, 이미 새 네트워크로 재스냅된
    // linkRef 보유)을 waypoint 삼아, convertBusRoutes()가 OSM way 좌표로 새 노선을 만들 때
    // 쓰는 것과 동일한 연결 파이프라인(findLinkPath 위상 보정 → extendToTerminal → 중복 루프
    // 제거)을 재사용해 link/node seq를 다시 만든다. prepareLinkIndex(새 네트워크)를 먼저
    // 호출해야 한다.
    private static final int MAX_ROUTE_REMAP_HOPS = 60; // 정류장 간 거리는 위상보정(6홉)보다 훨씬 멀 수 있음

    public record RemappedRoute(String linkSeq, String nodeSeq) {}

    /**
     * @param stationLinkRefsInOrder 노선이 지나는 정류장들의 (새 네트워크 기준) linkRef,
     *                                station.seq 순서 그대로. 연속 중복은 자동으로 걸러진다.
     * @return 실패(유효 앵커 2개 미만, 정류장 사이 경로 연결 불가, 터미널 미도달)하면
     *         null — 그 노선은 수동 재작업이 필요하다는 뜻.
     */
    public RemappedRoute remapBusRouteByStationAnchors(List<Long> stationLinkRefsInOrder) {
        if (stationLinkRefsInOrder == null) return null;
        List<Long> anchors = new ArrayList<>();
        for (Long id : stationLinkRefsInOrder) {
            if (id == null || linkById.get(id) == null) continue;
            if (!anchors.isEmpty() && anchors.get(anchors.size() - 1).equals(id)) continue;
            anchors.add(id);
        }
        if (anchors.size() < 2) return null; // 방향/경로를 판단할 최소 앵커(정류장) 부족

        List<Long> linkSeq = new ArrayList<>();
        linkSeq.add(anchors.get(0));
        for (int i = 1; i < anchors.size(); i++) {
            LinkXml prev = linkById.get(anchors.get(i - 1));
            LinkXml next = linkById.get(anchors.get(i));
            if (prev.getToNode() == null || next.getFromNode() == null) return null; // 위상 판단 불가
            if (prev.getToNode().equals(next.getFromNode())) {
                linkSeq.add(anchors.get(i));
                continue;
            }
            List<Long> bridge = findLinkPath(prev.getToNode(), next.getFromNode(), MAX_ROUTE_REMAP_HOPS);
            if (bridge == null) return null; // 두 정류장 사이를 새 네트워크에서 못 이음(위상이 크게 바뀜)
            linkSeq.addAll(bridge);
            linkSeq.add(anchors.get(i));
        }

        linkSeq = removeDuplicateLinkLoops(extendToTerminal(linkSeq));
        if (linkSeq.isEmpty() || !touchesTerminalAtBothEnds(linkSeq)) return null;

        String linkSeqStr = linkSeq.stream().map(String::valueOf).reduce((a, b) -> a + " " + b).orElse("");
        return new RemappedRoute(linkSeqStr, buildNodeSeq(linkSeq));
    }

    // ── 철도 노선 ─────────────────────────────────────────────────────────────

    /**
     * RailPtLineXml 포맷 + coords 배열 (OSM 역 좌표 직접 포함)
     *
     * <p>railStationSeq: relation의 member node 순서에서 실제 철도역으로 매칭된 노드만 골라
     * 우리 역 id로 치환해 채운다 — 이게 있어야 NextSim 실행용 railPTline.xml
     * (NextSimRunner.buildRailPtLineXml)이 이 노선을 실제로 인식한다.
     *
     * <p>⚠️ 실측 확인(강남역 인근 서울 지하철 2호선/신분당선): relation의 "stop" role 멤버는
     * railway=station이 아니라 **railway=stop**(public_transport=stop_position) 태그를 가진
     * 별도 노드다 — railStationIdByOsmNode(station 목록에서 만든 id 매핑)에는 없다. 대신 두
     * 노드 모두 보통 동일한 name 태그("시청", "신촌" 등)를 가지므로 이름으로 재매칭한다.
     * OsmOverpassService의 쿼리도 `.routes >;`를 추가해 이 stop 노드 자체를 가져오도록
     * 함께 수정함 — 안 그러면 좌표(osmNodeWgs84)조차 없어 coords에도 안 잡힌다.
     *
     * <p>fee/departureTime/timeOffsetSeq: OSM에는 요금·시간표 데이터가 없어 fee만 "0" 기본값을
     * 채우고 departureTime/timeOffsetSeq는 비워둔다 — 가짜 시간표를 지어내는 것보다 "철도 노선"
     * 편집 화면에서 사용자가 직접 채우도록 명시적으로 비워두는 편이 덜 혼란스럽다(실측: 이 값이
     * 없으면 해당 노선은 배차 없는 상태로 안전하게 남을 뿐 시뮬레이션이 깨지지 않음).
     */
    private Map<String, Object> convertRailRoutes(
            List<OsmOverpassService.OsmRelation> routes, double[] bbox,
            Map<Long, String> railStationIdByOsmNode, Map<String, String> railStationIdByName) {
        List<Map<String, Object>> routeList = new ArrayList<>();
        // ⚠️ 실측 확인(사용자 지적): 버스 Line id와 철도 Route id가 둘 다 1부터 시작해 완전히
        // 겹쳤다(scenario2_1: 버스 92개 전부 철도 id와 충돌). NextSim의 PTVertexArr/PTArcArr는
        // 버스+철도 노선을 함께 받아 하나의 PT 그래프를 구성하는데(바이너리 심볼로 확인), 이
        // id 충돌이 내부 자료구조를 오염시켜 시뮬레이션 중 std::out_of_range/vector 크래시로
        // 이어졌을 가능성이 있다. 철도 Route id를 버스 Line id와 절대 겹치지 않는 범위(10000+)
        // 로 옮겨 분리한다.
        int idSeq = 10_000;
        for (OsmOverpassService.OsmRelation rel : routes) {
            String name = rel.getTag("name");

            // 레일 노선은 지하 구간 way가 bbox에 걸리지 않아 way 기반이 부분적으로만 나옴.
            // 역 노드(memberNodeIds) 순서로 직접 연결하는 방식이 더 완전한 노선을 표현.
            List<Map<String, Double>> coords = new ArrayList<>();
            List<String> stationSeq = new ArrayList<>();
            for (Long nodeId : rel.memberNodeIds()) {
                double[] wgs = osmNodeWgs84.get(nodeId);
                if (wgs == null) continue;
                if (bbox != null) {
                    boolean inBbox = wgs[1] >= bbox[0] && wgs[1] <= bbox[2]
                                  && wgs[0] >= bbox[1] && wgs[0] <= bbox[3];
                    if (!inBbox) continue;
                }
                Map<String, Double> pt = new LinkedHashMap<>();
                pt.put("lng", wgs[0]);
                pt.put("lat", wgs[1]);
                coords.add(pt);

                String stationId = railStationIdByOsmNode.get(nodeId);
                if (stationId == null) {
                    OsmNode member = osmNodeById.get(nodeId);
                    String memberName = member != null ? member.getTag("name") : null;
                    if (memberName != null) stationId = railStationIdByName.get(memberName);
                }
                if (stationId != null) stationSeq.add(stationId);
            }
            // member 노드가 없을 경우에만 way 기반으로 fallback
            if (coords.isEmpty()) {
                coords = buildRouteCoords(rel.memberWayIds(), bbox);
            }

            Map<String, Object> route = new LinkedHashMap<>();
            route.put("id",             idSeq);
            route.put("name",           name != null ? name : "Line-" + idSeq);
            route.put("railStationSeq", String.join(" ", stationSeq));
            route.put("fee",            "0");
            route.put("coords",         coords);
            routeList.add(route);
            idSeq++;
        }
        String type = routes.isEmpty() ? "subway" : routes.get(0).getTag("route");
        log.info("철도 노선 변환: {}개 (coords 포함)", routeList.size());
        return Map.of("type", type != null ? type : "subway", "routes", routeList);
    }

    // ── 노선 좌표 구성 ────────────────────────────────────────────────────────

    private static final double MAX_GAP_DEG = 300.0 / 111000.0; // 300m in degrees

    /**
     * memberWayIds 순서대로 way 노드 좌표를 연결 (bbox 내부만, gap 처리).
     */
    private List<Map<String, Double>> buildRouteCoords(List<Long> wayIds, double[] bbox) {
        List<Map<String, Double>> result = new ArrayList<>();
        Long prevLastNode = null;
        double[] prevPt   = null;

        for (Long wayId : wayIds) {
            List<Long> nodeIds = osmWayNodes.get(wayId);
            if (nodeIds == null || nodeIds.isEmpty()) continue;

            // 이전 way 끝 노드와 방향 맞추기
            boolean reverse = false;
            if (prevLastNode != null) {
                Long firstNode = nodeIds.get(0);
                Long lastNode  = nodeIds.get(nodeIds.size() - 1);
                if (lastNode.equals(prevLastNode)) reverse = true;
            }

            List<Long> ordered = reverse ? new ArrayList<>(nodeIds) : new ArrayList<>(nodeIds);
            if (reverse) java.util.Collections.reverse(ordered);

            for (int i = 0; i < ordered.size(); i++) {
                double[] wgs = osmNodeWgs84.get(ordered.get(i));
                if (wgs == null) continue;

                // 이전 점과 거리 체크 — 500m 초과면 null separator
                if (prevPt != null) {
                    double dx = wgs[0] - prevPt[0], dy = wgs[1] - prevPt[1];
                    double dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > MAX_GAP_DEG) {
                        result.add(null); // gap separator
                    }
                }

                // bbox 범위 밖이면 gap separator 삽입 후 건너뜀
                if (bbox != null) {
                    boolean inBbox = wgs[1] >= bbox[0] && wgs[1] <= bbox[2]
                                  && wgs[0] >= bbox[1] && wgs[0] <= bbox[3];
                    if (!inBbox) {
                        if (!result.isEmpty() && result.get(result.size() - 1) != null) {
                            result.add(null); // gap
                        }
                        prevPt = null;
                        continue;
                    }
                }

                // 직전이 gap separator이면 null 하나만 유지하고 포인트 추가
                if (!result.isEmpty() && result.get(result.size() - 1) == null) {
                    // gap 유지 (이미 추가됨), 새 세그먼트 시작
                }
                Map<String, Double> pt = new LinkedHashMap<>();
                pt.put("lng", wgs[0]);
                pt.put("lat", wgs[1]);
                result.add(pt);
                prevPt = wgs;
            }
            if (!ordered.isEmpty()) {
                prevLastNode = ordered.get(ordered.size() - 1);
            }
        }

        // 끝 null 제거
        while (!result.isEmpty() && result.get(result.size() - 1) == null) {
            result.remove(result.size() - 1);
        }
        return result;
    }

    // ── 버스 노선 → 네트워크 링크 시퀀스 스냅 ────────────────────────────────

    /**
     * OSM 노선 좌표(WGS84, gap은 null)를 진행 방향을 지키며 실제 네트워크 링크 id 시퀀스로
     * 변환한다. 연속 구간마다 이동 벡터를 구해 {@link #snapToLink(double, double, double[])}
     * 로 방향이 맞는 링크만 후보로 삼고, 같은 링크가 연속되면 하나로 합친다.
     */
    private List<Long> snapRouteToLinks(
            List<Map<String, Double>> coords, List<LinkXml> links, double baseLat, double baseLon) {
        List<Long> result = new ArrayList<>();
        double[] prevXy = null;
        Long prevLinkId = null;
        for (Map<String, Double> pt : coords) {
            if (pt == null) { prevXy = null; continue; } // gap — 방향 연속성 끊음
            double lx = (pt.get("lng") - baseLon) * SCALE_X;
            double ly = (pt.get("lat") - baseLat) * SCALE_Y;

            if (prevXy != null) {
                double dx = lx - prevXy[0], dy = ly - prevXy[1];
                if (dx != 0 || dy != 0) {
                    SnapResult snap = snapToLink(lx, ly, new double[]{dx, dy}, topologicalCandidates(prevLinkId));
                    if (snap != null) {
                        if (result.isEmpty() || result.get(result.size() - 1) != snap.linkId()) {
                            result.add(snap.linkId());
                        }
                        prevLinkId = snap.linkId();
                    }
                }
            }
            prevXy = new double[]{lx, ly};
        }
        return removeDuplicateLinkLoops(repairTopologyGaps(result));
    }

    /**
     * ⚠️ 실측 확인(scenario2_1, 노선 81): 같은 링크 3개(A,B,C)가 시퀀스에 통째로 두 번
     * 나타나는 "루프" 패턴이 남아있었다(...,A,B,C,A,B,C,...) — GPS 노이즈로 잠깐 앞으로 갔다가
     * 다시 그 지점으로 돌아온 경우로 추정. 정류장이 이 반복 구간의 링크 위에 있으면 NextSim이
     * "Invalid distance for X -> X" 경고와 함께 이후 시뮬레이션 단계에서 불안정해졌다. 어떤
     * 링크가 이미 등장한 적이 있으면 그 지점 이후(=돌아오기 전까지의 우회 구간)를 통째로
     * 잘라내 항상 각 링크가 시퀀스에 한 번만 나오도록 정리한다.
     */
    private List<Long> removeDuplicateLinkLoops(List<Long> linkSeq) {
        List<Long> result = new ArrayList<>();
        Map<Long, Integer> indexInResult = new HashMap<>();
        for (Long id : linkSeq) {
            Integer pos = indexInResult.get(id);
            if (pos != null) {
                while (result.size() > pos + 1) {
                    Long removed = result.remove(result.size() - 1);
                    indexInResult.remove(removed);
                }
                continue;
            }
            indexInResult.put(id, result.size());
            result.add(id);
        }
        return result;
    }

    private static final int MAX_REPAIR_HOPS = 6;

    /**
     * ⚠️ 실측 크래시: topologicalCandidates가 50m 이내에 위상상 이어지는 링크가 없으면(교차로
     * 간격이 넓거나 GPS 포인트가 성긴 구간) 전체 최근접으로 폴백하는데, 그 최근접 링크가
     * 실제로는 이전 링크와 안 이어진(from_node≠직전 링크의 to_node) 링크일 수 있다 —
     * scenario2_1의 노선 하나(link.seq 25개 중 6개)에서 실측 확인. NextSim RouteGenerator의
     * PT Route Generation이 이 끊긴 지점에서 존재하지 않는 그래프 arc를 조회해
     * std::out_of_range로 크래시했다. 최종 링크 시퀀스에서 인접 링크 간 위상이 끊긴 곳을
     * BFS로 실제 연결 링크를 찾아 끼워 넣어 항상 연속된 시퀀스가 되도록 보정한다.
     */
    private List<Long> repairTopologyGaps(List<Long> raw) {
        if (raw.size() < 2) return raw;
        List<Long> repaired = new ArrayList<>();
        repaired.add(raw.get(0));
        for (int i = 1; i < raw.size(); i++) {
            Long prevId = repaired.get(repaired.size() - 1);
            Long curId = raw.get(i);
            LinkXml prev = linkById.get(prevId);
            LinkXml cur = linkById.get(curId);
            if (prev == null || cur == null || prevId.equals(curId)) {
                repaired.add(curId);
                continue;
            }
            if (prev.getToNode() != null && prev.getToNode().equals(cur.getFromNode())) {
                repaired.add(curId);
                continue;
            }
            List<Long> bridge = findLinkPath(prev.getToNode(), cur.getFromNode(), MAX_REPAIR_HOPS);
            if (bridge != null) repaired.addAll(bridge);
            repaired.add(curId);
        }
        return repaired;
    }

    /** fromNode→toNode로 이어지는 링크 경로를 BFS로 찾는다(최대 maxHops 홉). 못 찾으면 null. */
    private List<Long> findLinkPath(Long fromNode, Long toNode, int maxHops) {
        if (fromNode == null || toNode == null || fromNode.equals(toNode)) return List.of();
        Map<Long, Long> cameFromLink = new HashMap<>();
        Map<Long, Long> cameFromNode = new HashMap<>();
        Set<Long> visited = new HashSet<>();
        visited.add(fromNode);
        List<Long> currentLevel = new ArrayList<>();
        currentLevel.add(fromNode);
        for (int depth = 0; depth < maxHops && !currentLevel.isEmpty(); depth++) {
            List<Long> nextLevel = new ArrayList<>();
            for (Long node : currentLevel) {
                List<LinkXml> outs = outLinksByNode.get(node);
                if (outs == null) continue;
                for (LinkXml l : outs) {
                    Long nxt = l.getToNode();
                    if (nxt == null || visited.contains(nxt)) continue;
                    visited.add(nxt);
                    cameFromLink.put(nxt, l.getId());
                    cameFromNode.put(nxt, node);
                    if (nxt.equals(toNode)) {
                        List<Long> path = new ArrayList<>();
                        Long cur = nxt;
                        while (!cur.equals(fromNode)) {
                            path.add(cameFromLink.get(cur));
                            cur = cameFromNode.get(cur);
                        }
                        Collections.reverse(path);
                        return path;
                    }
                    nextLevel.add(nxt);
                }
            }
            currentLevel = nextLevel;
        }
        return null;
    }

    /**
     * ⚠️ 실측 확인된 NextSim 바이너리 결함(NEXTSIM_DATA_STRUCTURE.md #roadptline-xml,
     * 2026-07-27 scenario3_1로 최초 발견 — 이번 세션 scenario2_1에서 재확인): 노선의
     * 시작/끝 링크가 실제 네트워크 터미널 노드(type="terminal")에 닿아있지 않으면
     * route-generator가 PT Route Generation 단계에서 std::out_of_range(_Map_base::at)로
     * 크래시한다. 우리 XML 변환 코드 문제가 아니라 NextSim 자체 결함으로 판단되어(문서 참고)
     * 우회책으로 노선 시작/끝을 가장 가까운 터미널까지 BFS로 연장한다.
     */
    private List<Long> extendToTerminal(List<Long> linkSeq) {
        if (linkSeq.isEmpty() || terminalNodeIds.isEmpty()) return linkSeq;
        List<Long> result = new ArrayList<>(linkSeq);

        LinkXml first = linkById.get(result.get(0));
        if (first != null && first.getFromNode() != null && !terminalNodeIds.contains(first.getFromNode())) {
            List<Long> prefix = findPathToTerminal(first.getFromNode(), false);
            if (prefix != null) result.addAll(0, prefix);
        }

        LinkXml last = linkById.get(result.get(result.size() - 1));
        if (last != null && last.getToNode() != null && !terminalNodeIds.contains(last.getToNode())) {
            List<Long> suffix = findPathToTerminal(last.getToNode(), true);
            if (suffix != null) result.addAll(suffix);
        }
        return result;
    }

    /**
     * startNode에서 가장 가까운 터미널 노드까지의 링크 경로를 BFS로 찾는다.
     * forward=true면 출발 방향(outLinksByNode)으로, false면 역방향(inLinksByNode)으로 탐색한다
     * — 역방향 탐색 결과는 "터미널 → startNode" 순서(=extendToTerminal의 prefix)로 반환된다.
     * 못 찾으면 null.
     */
    // 터미널은 보통 네트워크 경계에만 있어서(교차로 안쪽 깊숙한 노선일수록) 위상 보정
    // (MAX_REPAIR_HOPS=6, 지엽적 끊김 전용)보다 훨씬 더 많은 홉이 필요할 수 있다.
    private static final int MAX_TERMINAL_SEARCH_HOPS = 300;

    private List<Long> findPathToTerminal(Long startNode, boolean forward) {
        if (startNode == null || terminalNodeIds.contains(startNode)) return List.of();
        Map<Long, List<LinkXml>> graph = forward ? outLinksByNode : inLinksByNode;
        Map<Long, Long> parent = new HashMap<>();
        Set<Long> visited = new HashSet<>();
        visited.add(startNode);
        List<Long> currentLevel = new ArrayList<>();
        currentLevel.add(startNode);
        Long terminal = null;
        for (int depth = 0; depth < MAX_TERMINAL_SEARCH_HOPS && terminal == null && !currentLevel.isEmpty(); depth++) {
            List<Long> nextLevel = new ArrayList<>();
            for (Long node : currentLevel) {
                List<LinkXml> edges = graph.get(node);
                if (edges == null) continue;
                for (LinkXml l : edges) {
                    Long nxt = forward ? l.getToNode() : l.getFromNode();
                    if (nxt == null || visited.contains(nxt)) continue;
                    visited.add(nxt);
                    parent.put(nxt, node);
                    if (terminalNodeIds.contains(nxt)) { terminal = nxt; break; }
                    nextLevel.add(nxt);
                }
                if (terminal != null) break;
            }
            currentLevel = nextLevel;
        }
        if (terminal == null) return null;

        List<Long> chain = new ArrayList<>();
        Long cur = terminal;
        while (cur != null) {
            chain.add(cur);
            if (cur.equals(startNode)) break;
            cur = parent.get(cur);
        }
        Collections.reverse(chain); // 탐색 진행 순서: forward면 startNode→terminal
        if (!forward) Collections.reverse(chain); // backward 탐색의 실제 진행방향은 terminal→startNode

        List<Long> linkPath = new ArrayList<>();
        for (int i = 0; i < chain.size() - 1; i++) {
            Long linkId = findLinkBetween(chain.get(i), chain.get(i + 1));
            if (linkId == null) return null; // 방어: 이론상 항상 존재
            linkPath.add(linkId);
        }
        return linkPath;
    }

    private boolean touchesTerminalAtBothEnds(List<Long> linkSeq) {
        LinkXml first = linkById.get(linkSeq.get(0));
        LinkXml last = linkById.get(linkSeq.get(linkSeq.size() - 1));
        return first != null && last != null
                && terminalNodeIds.contains(first.getFromNode())
                && terminalNodeIds.contains(last.getToNode());
    }

    private Long findLinkBetween(Long fromNode, Long toNode) {
        List<LinkXml> outs = outLinksByNode.get(fromNode);
        if (outs == null) return null;
        for (LinkXml l : outs) {
            if (toNode.equals(l.getToNode())) return l.getId();
        }
        return null;
    }

    /**
     * 직전에 스냅된 링크의 to_node에서 이어지는 링크(+직전 링크 자신, 저속/정차 구간에서
     * 같은 링크에 여러 점이 찍히는 경우)만 "다음 스냅 후보"로 인정한다.
     *
     * <p>⚠️ 실측 버그: 위상 연속성 없이 순수 최근접 거리로만 스냅하면(교차로 부근에 진행방향이
     * 비슷한 링크가 여러 개 몰려 있을 때) 노선이 엉뚱한 링크로 튀었다가 되돌아오길 반복해
     * 지도에서 노선이 서로 교차/역주행하는 것처럼 "꼬여 보이는" 현상이 났다(사용자 실측 리포트).
     * null을 반환하면(직전 링크 정보 없음/위상 후보 전무) {@link #snapToLink}가 기존처럼
     * 순수 최근접으로 폴백한다.
     */
    private Set<Long> topologicalCandidates(Long prevLinkId) {
        if (prevLinkId == null) return null;
        LinkXml prev = linkById.get(prevLinkId);
        if (prev == null || prev.getToNode() == null) return null;
        Set<Long> allowed = new HashSet<>();
        allowed.add(prevLinkId);
        List<LinkXml> next = outLinksByNode.get(prev.getToNode());
        if (next != null) for (LinkXml l : next) allowed.add(l.getId());
        return allowed;
    }

    /**
     * busStations 중 이 노선의 link.seq에 실제로 스냅된(link_ref 일치) 정류장만 골라
     * link.seq상의 등장 순서(→ 그 안에서는 offset)로 정렬해 station id 목록을 만든다.
     * 다른 노선/무관한 정류장은 link_ref가 안 겹쳐 자연히 제외된다.
     */
    private List<String> orderStationsAlongRoute(List<Long> linkSeq, List<BusStationResponse> busStations) {
        if (linkSeq.isEmpty() || busStations == null || busStations.isEmpty()) return List.of();
        Map<Long, Integer> linkOrder = new LinkedHashMap<>();
        for (int i = 0; i < linkSeq.size(); i++) linkOrder.putIfAbsent(linkSeq.get(i), i);

        List<BusStationResponse> matched = new ArrayList<>();
        for (BusStationResponse st : busStations) {
            if (st.getLinkRef() != null && linkOrder.containsKey(st.getLinkRef())) matched.add(st);
        }
        matched.sort(Comparator
                .<BusStationResponse>comparingInt(st -> linkOrder.get(st.getLinkRef()))
                .thenComparingDouble(st -> st.getOffset() != null ? st.getOffset() : 0.0));
        return matched.stream().map(BusStationResponse::getId).toList();
    }

    // ── 링크 스냅 (최근접 링크 매핑) ─────────────────────────────────────────

    private record SnapResult(long linkId, int laneId, double offset) {}

    private static long gridKey(int gx, int gy) {
        return (((long) gx) << 32) ^ (gy & 0xFFFFFFFFL);
    }

    /** links(로컬 x/y 기준 shape)를 100m 그리드에 인덱싱 — snapToLink가 전수 스캔 대신
     *  이 인덱스로 후보를 좁힌다. convert() 시작 시 한 번만 호출. */
    private void buildLinkGrid(List<LinkXml> links) {
        linkGrid.clear();
        linkShapeCache.clear();
        linkById.clear();
        outLinksByNode.clear();
        inLinksByNode.clear();
        for (LinkXml link : links) {
            if (link.getShape() == null || link.getShape().isBlank()) continue;
            List<double[]> pts = parseShape(link.getShape());
            if (pts.size() < 2) continue;
            linkShapeCache.put(link.getId(), pts);
            linkById.put(link.getId(), link);
            if (link.getFromNode() != null) {
                outLinksByNode.computeIfAbsent(link.getFromNode(), k -> new ArrayList<>()).add(link);
            }
            if (link.getToNode() != null) {
                inLinksByNode.computeIfAbsent(link.getToNode(), k -> new ArrayList<>()).add(link);
            }

            double minX = Double.MAX_VALUE, minY = Double.MAX_VALUE;
            double maxX = -Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
            for (double[] p : pts) {
                minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
                minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
            }
            int gx0 = (int) Math.floor(minX / GRID_CELL_M), gx1 = (int) Math.floor(maxX / GRID_CELL_M);
            int gy0 = (int) Math.floor(minY / GRID_CELL_M), gy1 = (int) Math.floor(maxY / GRID_CELL_M);
            for (int gx = gx0; gx <= gx1; gx++) {
                for (int gy = gy0; gy <= gy1; gy++) {
                    linkGrid.computeIfAbsent(gridKey(gx, gy), k -> new ArrayList<>()).add(link);
                }
            }
        }
    }

    /**
     * 로컬 좌표 (lx, ly)를 가장 가까운 링크에 스냅(방향 무시).
     * 링크 shape 폴리라인의 최근접 점 투영으로 offset 계산.
     */
    private SnapResult snapToLink(double lx, double ly) {
        return snapToLink(lx, ly, null);
    }

    /**
     * @param dir 진행 방향 벡터(정규화 불필요, null이면 방향 무시). 왕복 도로가 방향별로 분리된
     *            링크를 가질 때, 반대 방향 링크(세그먼트 방향과 내적&lt;=0)를 후보에서 제외해
     *            잘못된 방향으로 스냅되는 것을 막는다.
     */
    private SnapResult snapToLink(double lx, double ly, double[] dir) {
        return snapToLink(lx, ly, dir, null);
    }

    /**
     * @param preferredLinkIds null이 아니면 이 집합에 속한 링크를 최우선으로 찾는다(→
     *                          {@link #topologicalCandidates}). 집합 내에 임계거리 이내 후보가
     *                          있으면 전체 최근접 링크보다 그쪽을 택해 위상 연속성을 지킨다.
     *                          집합이 비어있거나(위상 정보 없음) 그 안에 임계거리 이내 후보가
     *                          없으면(경로가 실제로 다른 도로로 갈아탄 경우 등) 기존처럼 전체
     *                          최근접으로 폴백한다.
     */
    private SnapResult snapToLink(double lx, double ly, double[] dir, Set<Long> preferredLinkIds) {
        int gx = (int) Math.floor(lx / GRID_CELL_M), gy = (int) Math.floor(ly / GRID_CELL_M);
        Set<Long> seen = new HashSet<>();
        double bestDist = Double.MAX_VALUE;
        SnapResult best = null;
        double bestPreferredDist = Double.MAX_VALUE;
        SnapResult bestPreferred = null;

        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                List<LinkXml> candidates = linkGrid.get(gridKey(gx + dx, gy + dy));
                if (candidates == null) continue;
                for (LinkXml link : candidates) {
                    if (!seen.add(link.getId())) continue; // 여러 셀에 걸친 링크 중복 검사 방지

                    List<double[]> pts = linkShapeCache.get(link.getId());
                    if (pts == null || pts.size() < 2) continue;
                    boolean isPreferred = preferredLinkIds != null && preferredLinkIds.contains(link.getId());

                    double cumLen = 0.0;
                    for (int i = 0; i < pts.size() - 1; i++) {
                        double ax = pts.get(i)[0], ay = pts.get(i)[1];
                        double bx = pts.get(i + 1)[0], by = pts.get(i + 1)[1];
                        double segLen = dist(ax, ay, bx, by);

                        if (dir != null && segLen > 0) {
                            double segDx = bx - ax, segDy = by - ay;
                            double dot = segDx * dir[0] + segDy * dir[1];
                            if (dot <= 0) { cumLen += segLen; continue; } // 반대/직각 방향 세그먼트 제외
                        }

                        // 점→선분 투영
                        double[] proj = projectPointOnSegment(lx, ly, ax, ay, bx, by);
                        double d = dist(lx, ly, proj[0], proj[1]);
                        double t = segLen > 0 ? dist(ax, ay, proj[0], proj[1]) / segLen : 0;
                        double offset = cumLen + t * segLen;

                        if (d < bestDist) {
                            bestDist = d;
                            best = new SnapResult(link.getId(), 0, offset);
                        }
                        if (isPreferred && d < bestPreferredDist) {
                            bestPreferredDist = d;
                            bestPreferred = new SnapResult(link.getId(), 0, offset);
                        }
                        cumLen += segLen;
                    }
                }
            }
        }

        if (bestPreferred != null && bestPreferredDist <= MAX_SNAP_DIST_M) return bestPreferred;
        // ⚠️ 실측 크래시: preferredLinkIds가 있다는 건 이미 직전 링크가 확정된 상태라는 뜻인데,
        // 그 위상 후보 중 임계거리 이내가 없다고 전체 최근접(위상 무관)으로 폴백하면 실제로는
        // 안 이어진 링크를 골라버릴 수 있다(scenario2_1 실측: 링크 25개 중 6곳에서 발생, 뒤이어
        // NextSim RouteGenerator의 PT Route Generation이 존재하지 않는 그래프 arc를 조회해
        // std::out_of_range로 크래시). repairTopologyGaps의 BFS 보정도 애초에 "틀린 링크"가
        // 골라진 경우엔 이어붙일 경로가 없어 못 고친다 — 근본적으로 이 폴백 자체를 하지 말아야
        // 한다. preferredLinkIds가 없는(경로 시작점) 경우에만 전체 최근접 폴백을 허용한다.
        if (preferredLinkIds != null) return null;
        if (best == null || bestDist > MAX_SNAP_DIST_M) return null;
        return best;
    }

    // ── 기존 시설물 재스냅 (KTDB 재임포트, 자동생성 토글 꺼짐/OSM 재조회 실패) ──────────
    // 새 OSM 조회 없이 새 네트워크에 맞춰야 하는 경우 — 정류장/역 자체는 그대로 유지하고
    // (id/이름/부가정보 보존), 이미 저장된 좌표(center)만 새 네트워크의 링크에 다시 스냅한다.
    // convert()가 OSM 노드 좌표로 하던 것과 동일한 snapToLink를 저장된 좌표에 대해 재사용.

    public record ResnapResult(long linkId, int laneId, double offset) {}

    /** 링크 인덱스를 주어진 네트워크로 재구성한다 — resnapByLocalCoord 호출 전에 한 번 필요. */
    public void prepareLinkIndex(List<LinkXml> links) {
        buildLinkGrid(links);
    }

    /**
     * 터미널 노드 집합(type=Terminal)을 주어진 네트워크로 갱신한다 — {@link #remapBusRouteByStationAnchors}가
     * 내부적으로 쓰는 {@link #extendToTerminal}/{@link #touchesTerminalAtBothEnds}는 이 집합이
     * 비어있으면 무조건 실패(null)로 판정하므로, prepareLinkIndex와 함께 반드시 호출해야 한다.
     * convert()는 OSM 변환 중 이 집합을 함께 채우지만, remapBusRouteByStationAnchors만 단독으로
     * 쓰는 경로(예: "노선 그리기")는 convert()를 거치지 않으므로 별도 진입점이 필요하다.
     */
    public void prepareTerminalNodes(List<NodeXml> nodes) {
        terminalNodeIds.clear();
        if (nodes == null) return;
        for (NodeXml n : nodes) {
            if (n.getType() == NodeType.Terminal && n.getId() != null) terminalNodeIds.add(n.getId());
        }
    }

    /** center 문자열("lx ly", 로컬좌표)을 prepareLinkIndex로 준비된 네트워크에 재스냅한다.
     *  50m 밖이라 스냅 실패하거나 좌표 파싱 실패면 null. */
    public ResnapResult resnapByLocalCoord(String center) {
        double[] xy = parseLocalCoord(center);
        if (xy == null) return null;
        SnapResult snap = snapToLink(xy[0], xy[1]);
        return snap == null ? null : new ResnapResult(snap.linkId(), snap.laneId(), round2(snap.offset()));
    }

    private static double[] parseLocalCoord(String center) {
        if (center == null || center.isBlank()) return null;
        String[] parts = center.trim().split("\\s+");
        if (parts.length < 2) return null;
        try {
            return new double[]{Double.parseDouble(parts[0]), Double.parseDouble(parts[1])};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 로컬 좌표 문자열("x y")을 원점 이동만큼 평행이동한 새 문자열로 변환한다.
     *
     * <p>로컬 좌표는 시나리오 버전의 원점(위경도) 기준인데, KTDB 재임포트는 매번 원점을
     * bbox 중심으로 새로 잡는다({@code KtdbImportController.build()}가 versionId로 Scenario를
     * 못 찾아 기존 좌표 재사용 분기를 타지 않음 — 실측: 다른 bbox로 재임포트하자 저장된
     * 정류장 좌표가 일괄 ~700m 어긋나 재스냅이 전부 50m 밖 판정으로 실패). 재스냅 전에
     * 이 함수로 옛 원점 기준 좌표를 새 원점 기준으로 옮겨야 한다.
     *
     * @param dxM (옛 원점 경도 - 새 원점 경도) × {@link #SCALE_X}
     * @param dyM (옛 원점 위도 - 새 원점 위도) × {@link #SCALE_Y}
     * @return 변환된 "x y" 문자열, 파싱 실패면 원본 그대로
     */
    public static String shiftLocalCoord(String center, double dxM, double dyM) {
        double[] xy = parseLocalCoord(center);
        if (xy == null) return center;
        return String.format("%.3f %.3f", xy[0] + dxM, xy[1] + dyM);
    }

    /** 옛/새 원점 위경도로 로컬 좌표 평행이동량(dxM, dyM)을 계산한다. 옛 원점을 모르면 [0,0]. */
    public static double[] originShiftMeters(Double oldLat, Double oldLon, double newLat, double newLon) {
        if (oldLat == null || oldLon == null || (oldLat == 0.0 && oldLon == 0.0)) return new double[]{0, 0};
        return new double[]{(oldLon - newLon) * SCALE_X, (oldLat - newLat) * SCALE_Y};
    }

    private double[] projectPointOnSegment(double px, double py,
                                             double ax, double ay,
                                             double bx, double by) {
        double abx = bx - ax, aby = by - ay;
        double len2 = abx * abx + aby * aby;
        if (len2 == 0) return new double[]{ax, ay};
        double t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
        return new double[]{ax + t * abx, ay + t * aby};
    }

    private double dist(double x1, double y1, double x2, double y2) {
        double dx = x2 - x1, dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private List<double[]> parseShape(String shape) {
        List<double[]> pts = new ArrayList<>();
        for (String pt : shape.trim().split("\\s+")) {
            String[] xy = pt.split(",");
            if (xy.length < 2) continue;
            try {
                pts.add(new double[]{Double.parseDouble(xy[0]), Double.parseDouble(xy[1])});
            } catch (NumberFormatException ignored) {}
        }
        return pts;
    }

    private String fmt3(double v) { return String.format("%.3f", v); }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
