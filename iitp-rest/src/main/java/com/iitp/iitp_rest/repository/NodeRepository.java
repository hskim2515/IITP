package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.node.Node;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NodeRepository extends JpaRepository<Node, Long> {
}
