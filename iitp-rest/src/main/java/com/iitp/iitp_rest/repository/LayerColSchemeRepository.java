package com.iitp.iitp_rest.repository;


import com.iitp.iitp_rest.model.scheme.LayerColScheme;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LayerColSchemeRepository extends JpaRepository<LayerColScheme, Long> {
    List<LayerColScheme> findByLayerKey(String layerKey);

    List<LayerColScheme> findByRowKey(String rowKey);
}
