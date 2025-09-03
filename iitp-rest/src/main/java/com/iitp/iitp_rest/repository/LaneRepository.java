package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.link.Lane;
import com.iitp.iitp_rest.model.network.link.Link;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LaneRepository extends JpaRepository<Lane, Long> {
    List<Lane> findAllByLinkIn(List<Link> links);
    List<Lane> findAllByLink(Link link);
}
