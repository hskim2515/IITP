package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.link.Link;
import com.iitp.iitp_rest.model.network.link.LinkTreeResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;


public interface LinkRepository extends JpaRepository<Link, Long> {
    @Query("""
                SELECT NEW com.iitp.iitp_rest.model.network.link.LinkTreeResponse(
                l.id,
                l.fromNode,
                l.toNode,
                l.numLane,
                l.length,
                l.width,
                l.maxSpd,
                l.ffSpd,
                l.minSpd,
                l.waveSpd,
                l.qmax,
                l.maxVeh,
                l.simType,
                l.layer,
                l.type,
                l.stopLine,
                l.shape
                )
                FROM Link l
                WHERE l.network.id = :networkId
            """)
    List<LinkTreeResponse> findLinkTreeByNetworkId(@Param("networkId") Long networkId);
}
