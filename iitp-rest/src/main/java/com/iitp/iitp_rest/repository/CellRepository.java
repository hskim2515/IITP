package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.cell.Cell;
import com.iitp.iitp_rest.model.network.cell.CellTreeResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface CellRepository extends JpaRepository<Cell, Long> {

    @Query("""
                SELECT NEW com.iitp.iitp_rest.model.network.cell.CellTreeResponse(
                    c.lane.id,
                    c.id,
                    c.length,
                    c.offset
                )
                FROM Cell c WHERE c.lane.id IN :laneIds
            """)
    List<CellTreeResponse> findCellTreeByLaneIds(@Param("laneIds") List<Long> laneIds);
}
