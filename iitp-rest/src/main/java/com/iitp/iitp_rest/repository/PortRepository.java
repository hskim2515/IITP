package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.node.Port;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PortRepository extends JpaRepository<Port, Long> {
}
