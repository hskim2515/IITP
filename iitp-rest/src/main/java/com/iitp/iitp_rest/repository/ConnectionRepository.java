package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.node.Connection;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectionRepository extends JpaRepository<Connection, Long> {
}
