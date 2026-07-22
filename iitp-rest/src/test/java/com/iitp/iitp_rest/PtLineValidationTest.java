package com.iitp.iitp_rest;

import com.iitp.iitp_rest.service.publicTransit.line.PtLineValidation;
import org.junit.jupiter.api.Test;

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
}
