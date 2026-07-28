package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
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

            BusStationResponse station = new BusStationResponse();
            station.setId(String.valueOf(idGen.getAndIncrement()));
            station.setTransitMode(TransitMode.bus);
            station.setCenter(fmt3(lx) + " " + fmt3(ly));
            station.setType(StationType.side);

            if (snap != null) {
                station.setLinkRef(snap.linkId());
                station.setLaneRef((long) snap.laneId());
                station.setOffset(round2(snap.offset()));
            }

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
                exit.setId(String.valueOf(idGen.get()));
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
        int idSeq = 1;
        for (OsmOverpassService.OsmRelation rel : routes) {
            String name   = rel.getTag("name");
            String ref    = rel.getTag("ref");
            String lineId = ref != null ? ref : String.valueOf(idSeq);

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

            List<Long> linkSeq = snapRouteToLinks(coords, links, baseLat, baseLon);
            List<String> stationSeq = orderStationsAlongRoute(linkSeq, busStations);

            Map<String, Object> line = new LinkedHashMap<>();
            line.put("id",       lineId);
            line.put("name",     name != null ? name : lineId);
            line.put("interval", defaultIntervalMin);
            line.put("coords",   coords);
            line.put("link",     Map.of("seq", linkSeq.stream().map(String::valueOf).reduce((a,b) -> a + " " + b).orElse("")));
            line.put("node",     Map.of("seq", ""));
            line.put("station",  Map.of("seq", String.join(" ", stationSeq)));
            line.put("garage",   Map.of("seq", ""));

            lines.add(line);
            idSeq++;
        }
        log.info("버스 노선 변환: {}개 (coords 포함)", lines.size());
        return Map.of("lines", lines);
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
        int idSeq = 1;
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
        for (Map<String, Double> pt : coords) {
            if (pt == null) { prevXy = null; continue; } // gap — 방향 연속성 끊음
            double lx = (pt.get("lng") - baseLon) * SCALE_X;
            double ly = (pt.get("lat") - baseLat) * SCALE_Y;

            if (prevXy != null) {
                double dx = lx - prevXy[0], dy = ly - prevXy[1];
                if (dx != 0 || dy != 0) {
                    SnapResult snap = snapToLink(lx, ly, new double[]{dx, dy});
                    if (snap != null && (result.isEmpty() || result.get(result.size() - 1) != snap.linkId())) {
                        result.add(snap.linkId());
                    }
                }
            }
            prevXy = new double[]{lx, ly};
        }
        return result;
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
        for (LinkXml link : links) {
            if (link.getShape() == null || link.getShape().isBlank()) continue;
            List<double[]> pts = parseShape(link.getShape());
            if (pts.size() < 2) continue;
            linkShapeCache.put(link.getId(), pts);

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
        int gx = (int) Math.floor(lx / GRID_CELL_M), gy = (int) Math.floor(ly / GRID_CELL_M);
        Set<Long> seen = new HashSet<>();
        double bestDist = Double.MAX_VALUE;
        SnapResult best = null;

        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                List<LinkXml> candidates = linkGrid.get(gridKey(gx + dx, gy + dy));
                if (candidates == null) continue;
                for (LinkXml link : candidates) {
                    if (!seen.add(link.getId())) continue; // 여러 셀에 걸친 링크 중복 검사 방지

                    List<double[]> pts = linkShapeCache.get(link.getId());
                    if (pts == null || pts.size() < 2) continue;

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

                        if (d < bestDist) {
                            bestDist = d;
                            double t = segLen > 0 ? dist(ax, ay, proj[0], proj[1]) / segLen : 0;
                            double offset = cumLen + t * segLen;
                            best = new SnapResult(link.getId(), 0, offset);
                        }
                        cumLen += segLen;
                    }
                }
            }
        }

        if (best == null || bestDist > MAX_SNAP_DIST_M) return null;
        return best;
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
