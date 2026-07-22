package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.network.cell.CellResponse;
import com.iitp.iitp_rest.model.network.lane.LaneResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 링크↔레인 연쇄 검증 — 수동으로 그린 링크(또는 그 어떤 이유로든 cells 가 빈 링크)는
 * numCell 은 저장되지만 실제 <cell> 원소가 하나도 없이 network.xml에 저장되던 문제.
 * NetworkTileService.ensureCellsGenerated 가 applyDiff 안에서 이 빈틈을 메운다 —
 * 도로 편집 모드/그리드 편집 둘 다 결국 이 applyDiff 를 거치므로 한 곳만 검증하면 된다.
 */
class NetworkTileServiceCellGenerationTest {

    private static LinkResponse linkWith(double length, int numCell, List<CellResponse> cells) {
        LinkResponse link = new LinkResponse();
        link.setId(1L);
        link.setLength(length);
        LaneResponse lane = new LaneResponse();
        lane.setId(0L);
        lane.setNumCell(numCell);
        lane.setCells(cells);
        link.setLanes(List.of(lane));
        return link;
    }

    @Test
    void fills_empty_cells_respecting_existing_numCell() {
        LinkResponse link = linkWith(50.0, 10, List.of()); // numCell=10 이미 저장돼 있음(빈 cells)
        NetworkTileService.ensureCellsGenerated(link);

        List<CellResponse> cells = link.getLanes().get(0).getCells();
        assertEquals(10, cells.size(), "기존 numCell 규약을 그대로 존중해야 함");
        assertEquals(10, link.getLanes().get(0).getNumCell());

        double totalLen = cells.stream().mapToDouble(CellResponse::getLength).sum();
        assertEquals(50.0, totalLen, 0.05, "cell 길이 합은 링크 길이와 같아야 함");

        // offset 이 순서대로 누적돼야 함(빈틈/중복 없이)
        double expectedOffset = 0;
        for (CellResponse c : cells) {
            assertEquals(expectedOffset, c.getOffset(), 0.05);
            expectedOffset += c.getLength();
        }
    }

    @Test
    void falls_back_to_length_based_split_when_numCell_is_missing() {
        LinkResponse link = linkWith(45.0, 0, List.of()); // numCell 자체도 없음(0)
        NetworkTileService.ensureCellsGenerated(link);

        LaneResponse lane = link.getLanes().get(0);
        assertFalse(lane.getCells().isEmpty(), "numCell 이 없어도 길이 기준 폴백으로 채워야 함");
        assertEquals(lane.getCells().size(), lane.getNumCell(), "생성된 cell 개수와 numCell 이 일치해야 함");
    }

    @Test
    void does_not_touch_lanes_that_already_have_cells() {
        CellResponse existing = new CellResponse();
        existing.setId(0L);
        existing.setLength(50.0);
        existing.setOffset(0.0);
        LinkResponse link = linkWith(50.0, 1, List.of(existing));

        NetworkTileService.ensureCellsGenerated(link);

        assertSame(existing, link.getLanes().get(0).getCells().get(0), "이미 채워진 cells 는 건드리면 안 됨");
    }

    @Test
    void ignores_links_with_no_lanes_or_zero_length() {
        LinkResponse noLanes = new LinkResponse();
        noLanes.setId(2L);
        noLanes.setLength(30.0);
        noLanes.setLanes(null);
        assertDoesNotThrow(() -> NetworkTileService.ensureCellsGenerated(noLanes));

        LinkResponse zeroLength = linkWith(0.0, 3, List.of());
        NetworkTileService.ensureCellsGenerated(zeroLength);
        assertTrue(zeroLength.getLanes().get(0).getCells().isEmpty(), "길이 0인 링크는 생성 시도 자체를 건너뛰어야 함");
    }
}
