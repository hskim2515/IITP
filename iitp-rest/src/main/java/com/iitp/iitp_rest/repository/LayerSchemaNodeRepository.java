package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.LayerSchemaNode;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

public interface LayerSchemaNodeRepository extends JpaRepository<LayerSchemaNode, Long> {

    List<LayerSchemaNode> findAllByLayerId(Long layerId);
    @Query("select distinct n.layer.id from LayerSchemaNode n where n.layer is not null")
    List<Long> findDistinctLayerIds();
    List<LayerSchemaNode> findAllByLayerIdIn(Collection<Long> layerId);
    List<LayerSchemaNode> findAllByParentId(Long parentId);
    List<LayerSchemaNode> findAllByRootId(Long rootId);

}
