package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.LayerSchema;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

public interface LayerSchemaRepository extends JpaRepository<LayerSchema, Long> {

    List<LayerSchema> findAllByLayerId(Long layerId);
    @Query("select distinct n.layer.id from LayerSchema n where n.layer is not null")
    List<Long> findDistinctLayerIds();
    List<LayerSchema> findAllByLayerIdIn(Collection<Long> layerId);
}
