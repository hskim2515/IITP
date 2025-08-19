package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.LayerSchemaField;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface LayerSchemaFieldRepository extends JpaRepository<LayerSchemaField, Long> {

    List<LayerSchemaField> findAllByLayerSchemaNodeId(Long nodeId);
    List<LayerSchemaField> findAllByLayerSchemaNode_Layer_Id(Long layerId);
    List<LayerSchemaField> findAllByLayerSchemaNode_Layer_IdIn(Collection<Long> nodeId);
}
