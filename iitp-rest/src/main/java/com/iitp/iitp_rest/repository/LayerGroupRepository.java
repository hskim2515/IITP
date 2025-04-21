package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.layer.LayerGroup;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LayerGroupRepository extends JpaRepository<LayerGroup, Long> {
    LayerGroup findByKey(String key);
}

