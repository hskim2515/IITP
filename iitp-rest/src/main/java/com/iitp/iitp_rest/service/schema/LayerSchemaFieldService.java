package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.schema.LayerSchemaField;
import com.iitp.iitp_rest.repository.LayerSchemaFieldRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class LayerSchemaFieldService {

    private final LayerSchemaFieldRepository layerSchemaFieldRepository;

    public List<LayerSchemaField> getSchemaFields() {
        return layerSchemaFieldRepository.findAll();
    }

    public List<LayerSchemaField> getSchemaFieldsByNodeId(Long nodeId) {
        return layerSchemaFieldRepository.findAllByLayerSchemaId(nodeId);
    }

    public LayerSchemaField findById(Long id) {
        return layerSchemaFieldRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("LayerSchemaField not found, id:::" + id));
    }
    public LayerSchemaField save(LayerSchemaField entity) {
        return layerSchemaFieldRepository.save(entity);
    }
}
