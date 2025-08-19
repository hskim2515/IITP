package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.layer.Layer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface LayerRepository extends JpaRepository<Layer, Long> {

    List<Layer> findAll();

    List<Layer> findByGroup_Key(String groupKey);

    @Query("select l.key from Layer l where l.id = :id")
    Optional<String> findKeyById(@Param("id") Long id);
}

