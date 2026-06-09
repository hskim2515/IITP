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

    public record FacilityResult(
        PublicTransitResponse busStations,
        RailPublicTransitResponse railStations,
        Map<String, Object> busRoutes,
        Map<String, Object> railRoutes
    ) {}

    // OSM 노드 WGS84 캐시 (id → [lon, lat])
    private final Map<Long, double[]> osmNodeWgs84 = new LinkedHashMap<>();
    // OSM way 캐시 (wayId → nodeIds 순서)
    private final Map<Long, List<Long>> osmWayNodes = new LinkedHashMap<>();

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

        List<LinkXml> links = networkXml.getLinks() != null ? networkXml.getLinks() : List.of();

        // 전체 노드/way 캐시 구성
        osmNodeWgs84.clear();
        osmWayNodes.clear();
        for (OsmNode n : facilities.allNodes())
            osmNodeWgs84.put(n.getId(), new double[]{n.getLon(), n.getLat()});
        for (OsmWay w : facilities.allWays())
            osmWayNodes.put(w.getId(), w.getNodeIds());

        PublicTransitResponse busStations = convertBusStops(
                facilities.busStops(), links, baseLat, baseLon);
        RailPublicTransitResponse railStations = convertRailStations(
                facilities.railStations(), links, baseLat, baseLon);
        Map<String, Object> busRoutes  = convertBusRoutes(facilities.busRoutes(), bbox);
        Map<String, Object> railRoutes = convertRailRoutes(facilities.railRoutes(), bbox);

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

            SnapResult snap = snapToLink(lx, ly, links);

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
            List<OsmNode> stations, List<LinkXml> links, double baseLat, double baseLon) {

        AtomicLong idGen = new AtomicLong(31000001L);
        List<RailStationResponse> result = new ArrayList<>();

        for (OsmNode st : stations) {
            double lx = (st.getLon() - baseLon) * SCALE_X;
            double ly = (st.getLat() - baseLat) * SCALE_Y;

            SnapResult snap = snapToLink(lx, ly, links);

            RailStationResponse station = new RailStationResponse();
            station.setId(String.valueOf(idGen.getAndIncrement()));
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
            if (name != null) station.setAddress(name);

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
     * 레이어에서 link.seq 대신 coords로 노선 선형 표현.
     */
    private Map<String, Object> convertBusRoutes(List<OsmOverpassService.OsmRelation> routes, double[] bbox) {
        List<Map<String, Object>> lines = new ArrayList<>();
        int idSeq = 1;
        for (OsmOverpassService.OsmRelation rel : routes) {
            String name   = rel.getTag("name");
            String ref    = rel.getTag("ref");
            String lineId = ref != null ? ref : String.valueOf(idSeq);

            // way 노드 순서를 따라 실제 도로 형상 좌표 수집 (bbox 내부만)
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

            Map<String, Object> line = new LinkedHashMap<>();
            line.put("id",       lineId);
            line.put("name",     name != null ? name : lineId);
            line.put("interval", 10);
            line.put("coords",   coords);
            line.put("link",     Map.of("seq", ""));
            line.put("node",     Map.of("seq", ""));
            line.put("station",  Map.of("seq", ""));
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
     */
    private Map<String, Object> convertRailRoutes(List<OsmOverpassService.OsmRelation> routes, double[] bbox) {
        List<Map<String, Object>> routeList = new ArrayList<>();
        int idSeq = 1;
        for (OsmOverpassService.OsmRelation rel : routes) {
            String name = rel.getTag("name");

            // 레일 노선은 지하 구간 way가 bbox에 걸리지 않아 way 기반이 부분적으로만 나옴.
            // 역 노드(memberNodeIds) 순서로 직접 연결하는 방식이 더 완전한 노선을 표현.
            List<Map<String, Double>> coords = new ArrayList<>();
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
            // member 노드가 없을 경우에만 way 기반으로 fallback
            if (coords.isEmpty()) {
                coords = buildRouteCoords(rel.memberWayIds(), bbox);
            }

            Map<String, Object> route = new LinkedHashMap<>();
            route.put("id",             idSeq);
            route.put("name",           name != null ? name : "Line-" + idSeq);
            route.put("railStationSeq", "");
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

    // ── 링크 스냅 (최근접 링크 매핑) ─────────────────────────────────────────

    private record SnapResult(long linkId, int laneId, double offset) {}

    /**
     * 로컬 좌표 (lx, ly)를 가장 가까운 링크에 스냅.
     * 링크 shape 폴리라인의 최근접 점 투영으로 offset 계산.
     */
    private SnapResult snapToLink(double lx, double ly, List<LinkXml> links) {
        double bestDist = Double.MAX_VALUE;
        SnapResult best = null;

        for (LinkXml link : links) {
            if (link.getShape() == null || link.getShape().isBlank()) continue;

            List<double[]> pts = parseShape(link.getShape());
            if (pts.size() < 2) continue;

            double cumLen = 0.0;
            for (int i = 0; i < pts.size() - 1; i++) {
                double ax = pts.get(i)[0], ay = pts.get(i)[1];
                double bx = pts.get(i+1)[0], by = pts.get(i+1)[1];
                double segLen = dist(ax, ay, bx, by);

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
