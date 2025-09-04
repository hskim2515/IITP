package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.node.Node;
import com.iitp.iitp_rest.model.network.node.NodeTreeResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface NodeRepository extends JpaRepository<Node, Long> {

    List<Node> findAllByNetwork_Id(Long id);

    @Query("""
            SELECT NEW com.iitp.iitp_rest.model.network.node.NodeTreeResponse(
                n.id,
                n.type,
                n.v2x,
                n.numPort,
                n.numConnection,
                n.center
            )
            FROM Node n
            WHERE n.network.id = :networkId
            """)
    List<NodeTreeResponse> findNodeTreeByNetworkId(@Param("networkId")Long networkId);
}
