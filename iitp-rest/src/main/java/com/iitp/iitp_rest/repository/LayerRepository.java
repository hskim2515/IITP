package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.layer.Layer;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LayerRepository extends JpaRepository<Layer, Long> {

    List<Layer> findAll();

    List<Layer> findByGroup_Key(String groupKey);
}

