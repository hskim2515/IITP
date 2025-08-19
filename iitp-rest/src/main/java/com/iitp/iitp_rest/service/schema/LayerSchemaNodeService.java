package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.schema.LayerSchemaNode;
import com.iitp.iitp_rest.repository.LayerSchemaNodeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class LayerSchemaNodeService {

    private final LayerSchemaNodeRepository layerSchemaNodeRepository;

    public List<LayerSchemaNode> getSchemaNodes() {
        return layerSchemaNodeRepository.findAll();
    }

    public List<LayerSchemaNode> getSchemaNodesByLayerId(Long layerId) {
        return layerSchemaNodeRepository.findAllByLayerId(layerId);
    }

    public List<LayerSchemaNode> getSchemaNodesByParentId(Long parentId) {
        return layerSchemaNodeRepository.findAllByParentId(parentId);
    }
    public List<LayerSchemaNode> getSchemaNodesByRootId(Long rootId) {
        return layerSchemaNodeRepository.findAllByRootId(rootId);
    }

    public LayerSchemaNode getSchemaNodeById(Long id) {
        return layerSchemaNodeRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("LayerSchemaNode not found, id:::" + id));
    }
    public LayerSchemaNode save(LayerSchemaNode entity) {
        return layerSchemaNodeRepository.save(entity);
    }
}
