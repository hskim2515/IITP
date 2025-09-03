package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.link.Link;
import org.springframework.data.jpa.repository.JpaRepository;


public interface LinkRepository extends JpaRepository<Link, Long> {

}
