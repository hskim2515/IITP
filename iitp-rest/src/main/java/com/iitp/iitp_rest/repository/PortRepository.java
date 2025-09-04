package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.port.Port;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import com.iitp.iitp_rest.model.network.port.PortTreeResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface PortRepository extends JpaRepository<Port, Long> {

    @Query("""
            SELECT NEW com.iitp.iitp_rest.model.network.port.PortTreeResponse(
                p.node.id,
                p.type,
                p.linkId,
                p.direction
            )
            FROM Port p
            WHERE p.node.id IN :nodeIds
            """)
    List<PortTreeResponse> findPortDtoByNodeIds(@Param("nodeIds") List<Long> nodeIds);
}
