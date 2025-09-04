package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.segment.Segment;
import com.iitp.iitp_rest.model.network.segment.SegmentTreeResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SegmentRepository extends JpaRepository<Segment, Long> {
    @Query("""
                SELECT NEW com.iitp.iitp_rest.model.network.segment.SegmentTreeResponse(
                    s.lane.id,
                    s.id,
                    s.block,
                    s.initPoint,
                    s.endPoint
                ) 
                FROM Segment s WHERE s.lane.id IN :laneIds
            """)
    List<SegmentTreeResponse> findSegmentTreeByLaneIds(@Param("laneIds") List<Long> laneIds);
}
