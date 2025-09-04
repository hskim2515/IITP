package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.lane.Lane;
import com.iitp.iitp_rest.model.network.lane.LaneTreeResponse;
import com.iitp.iitp_rest.model.network.link.Link;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface LaneRepository extends JpaRepository<Lane, Long> {
    List<Lane> findAllByLinkIn(List<Link> links);
    List<Lane> findAllByLink(Link link);

    @Query("""
                SELECT NEW com.iitp.iitp_rest.model.network.lane.LaneTreeResponse(
                l.link.id,
                l.laneId,
                l.id,
                l.leftLaneId,
                l.rightLaneId,
                l.numCell,
                l.laneAccessType,
                l.rightLC,
                l.leftLC,
                l.shape
                )
                FROM Lane l WHERE l.link.id IN :linkIds
            """)
    List<LaneTreeResponse> findLaneTreeByLinkIds(@Param("linkIds") List<Long> linkIds);
}
