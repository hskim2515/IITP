package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.connection.Connection;
import com.iitp.iitp_rest.model.network.connection.ConnectionTreeResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface ConnectionRepository extends JpaRepository<Connection, Long> {
    @Query("""
            SELECT NEW com.iitp.iitp_rest.model.network.connection.ConnectionTreeResponse(
                 c.node.id,
                 c.id,
                 c.fromLink,
                 c.fromLane,
                 c.toLink,
                 c.toLane,
                 c.turning,
                 c.length,
                 c.width,
                 c.ffSpd,
                 c.shape
             )
             FROM Connection c
             WHERE c.node.id IN :nodeIds
            """)
    List<ConnectionTreeResponse> findConnectionDtoByNodeIds(@Param("nodeIds")List<Long> sublist);
}
