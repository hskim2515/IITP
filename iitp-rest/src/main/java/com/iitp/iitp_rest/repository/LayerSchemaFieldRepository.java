package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.LayerSchemaField;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface LayerSchemaFieldRepository extends JpaRepository<LayerSchemaField, Long> {

    List<LayerSchemaField> findAllByLayerSchemaId(Long schemaId);
    List<LayerSchemaField> findAllByLayerSchema_Layer_Id(Long layerId);
    List<LayerSchemaField> findAllByLayerSchema_Layer_IdIn(Collection<Long> schemaId);
}
