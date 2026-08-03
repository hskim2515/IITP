package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
import com.iitp.iitp_rest.service.publicTransit.line.PtLineValidation;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 버스/철도 노선 검증기 — KTDB 재임포트로 link/node id 가 전면 교체돼도 기존 노선(roadPTline.xml/
 * railPTLine.xml)은 옛 id 를 그대로 들고 저장까지 됐지만 검증하는 코드 자체가 없던 문제
 * (signal.xml/odmatrix.xml 은 이미 검증기가 있는데 노선만 빠져 있었음).
 */
class PtLineValidationTest {

    private static final String LINES_XML =
            "<?xml version=\"1.0\"?>\n<Lines>\n" +
            "  <Line id=\"1\" interval=\"600\">\n" +
            "    <link seq=\"20000001 20000002\"/>\n" +
            "    <node seq=\"10000001 10000002\"/>\n" +
            "    <station seq=\"1 2\"/>\n" +
            "    <garage seq=\"12000001\"/>\n" +
            "  </Line>\n" +
            "</Lines>";

    @Test
    void bus_route_valid_when_all_link_and_node_ids_exist() {
        assertTrue(PtLineValidation.busRouteValid(LINES_XML,
                Set.of("20000001", "20000002"), Set.of("10000001", "10000002")));
    }

    @Test
    void bus_route_stale_when_link_id_missing_after_reimport() {
        // 재임포트로 링크 id 전면 교체 — 옛 링크 하나가 새 집합에 없음
        assertFalse(PtLineValidation.busRouteValid(LINES_XML,
                Set.of("20009999", "20000002"), Set.of("10000001", "10000002")));
    }

    @Test
    void bus_route_stale_when_node_id_missing_after_reimport() {
        assertFalse(PtLineValidation.busRouteValid(LINES_XML,
                Set.of("20000001", "20000002"), Set.of("10009999", "10000002")));
    }

    @Test
    void bus_route_ignores_station_and_garage_seq() {
        // station/garage 는 KTDB 재임포트로 안 바뀌는 별도 네임스페이스 — 대상 집합이 텅 비어도
        // (station/garage id 조회 자체를 안 넘겨도) link/node 만 맞으면 유효해야 함
        assertTrue(PtLineValidation.busRouteValid(LINES_XML,
                Set.of("20000001", "20000002"), Set.of("10000001", "10000002")));
    }

    @Test
    void bus_route_valid_when_content_blank_or_no_refs() {
        assertTrue(PtLineValidation.busRouteValid(null, Set.of(), Set.of()));
        assertTrue(PtLineValidation.busRouteValid("", Set.of(), Set.of()));
        assertTrue(PtLineValidation.busRouteValid("<Lines></Lines>", Set.of(), Set.of()));
    }

    private static final String ROUTES_XML =
            "<?xml version=\"1.0\"?>\n<Mode type=\"rail\">\n<routes>\n" +
            "  <route id=\"1\" name=\"1호선\" railStationSeq=\"1 2 3\"/>\n" +
            "</routes>\n</Mode>";

    @Test
    void rail_route_valid_when_all_station_ids_exist() {
        assertTrue(PtLineValidation.railRouteValid(ROUTES_XML, Set.of("1", "2", "3")));
    }

    @Test
    void rail_route_stale_when_station_deleted() {
        assertFalse(PtLineValidation.railRouteValid(ROUTES_XML, Set.of("1", "2")));
    }

    @Test
    void rail_route_valid_when_content_blank_or_ids_unknown() {
        assertTrue(PtLineValidation.railRouteValid(null, Set.of()));
        assertTrue(PtLineValidation.railRouteValid("", Set.of()));
        // 대조할 정류장 집합 자체를 모르면(null) 보수적으로 유지
        assertTrue(PtLineValidation.railRouteValid(ROUTES_XML, null));
    }

    // ── findBusLinesMissingRouting / findRailRoutesMissingStationSeq ──────────
    // 부천 원본 roadPTline.xml(중첩 <links><link id=".." station=".."/></links> 스키마)을
    // 이 앱의 평평한 스키마로 그대로 파싱하면 link/node/station이 전부 null이 되어 NextSim이
    // 터미널 조합과 무관하게 크래시하던 실사용 버그의 회귀 방지 테스트.

    private static BusPtLinesXml.SeqXml seq(String s) {
        BusPtLinesXml.SeqXml x = new BusPtLinesXml.SeqXml();
        x.setSeq(s);
        return x;
    }

    private static BusPtLinesXml.LineXml busLine(String id, BusPtLinesXml.SeqXml link, BusPtLinesXml.SeqXml node, BusPtLinesXml.SeqXml station) {
        BusPtLinesXml.LineXml l = new BusPtLinesXml.LineXml();
        l.setId(id);
        l.setLink(link);
        l.setNode(node);
        l.setStation(station);
        return l;
    }

    @Test
    void findBusLinesMissingRouting_flags_null_link_node_station() {
        // 중첩 스키마 파싱 후처럼 link/node/station이 전부 null인 경우
        BusPtLinesXml xml = new BusPtLinesXml();
        xml.setLines(List.of(busLine("Bus6-2_out", null, null, null)));

        List<String> bad = PtLineValidation.findBusLinesMissingRouting(xml);
        assertEquals(List.of("Bus6-2_out"), bad);
    }

    @Test
    void findBusLinesMissingRouting_flags_blank_seq_values() {
        BusPtLinesXml xml = new BusPtLinesXml();
        xml.setLines(List.of(busLine("1", seq("20000001 20000002"), seq("10000001 10000002"), seq(""))));

        List<String> bad = PtLineValidation.findBusLinesMissingRouting(xml);
        assertEquals(List.of("1"), bad);
    }

    @Test
    void findBusLinesMissingRouting_passes_when_fully_populated() {
        BusPtLinesXml xml = new BusPtLinesXml();
        xml.setLines(List.of(busLine("1", seq("20000001 20000002"), seq("10000001 10000002"), seq("1 2"))));

        assertTrue(PtLineValidation.findBusLinesMissingRouting(xml).isEmpty());
    }

    @Test
    void findBusLinesMissingRouting_empty_for_no_lines() {
        BusPtLinesXml xml = new BusPtLinesXml();
        assertTrue(PtLineValidation.findBusLinesMissingRouting(xml).isEmpty());
        assertTrue(PtLineValidation.findBusLinesMissingRouting(null).isEmpty());
    }

    private static RailPtLineXml.RouteXml railRoute(Integer id, String railStationSeq) {
        RailPtLineXml.RouteXml r = new RailPtLineXml.RouteXml();
        r.setId(id);
        r.setRailStationSeq(railStationSeq);
        return r;
    }

    @Test
    void findRailRoutesMissingStationSeq_flags_null_and_blank() {
        RailPtLineXml xml = new RailPtLineXml();
        xml.setRoutes(List.of(railRoute(1, null), railRoute(2, ""), railRoute(3, "1 2 3")));

        List<String> bad = PtLineValidation.findRailRoutesMissingStationSeq(xml);
        assertEquals(List.of("1", "2"), bad);
    }

    @Test
    void findRailRoutesMissingStationSeq_empty_for_no_routes() {
        assertTrue(PtLineValidation.findRailRoutesMissingStationSeq(new RailPtLineXml()).isEmpty());
        assertTrue(PtLineValidation.findRailRoutesMissingStationSeq(null).isEmpty());
    }
}
