package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.schema.*;
import com.iitp.iitp_rest.repository.LayerSchemaFieldRepository;
import com.iitp.iitp_rest.repository.LayerSchemaOptionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class LayerSchemaFieldService {

    private final LayerSchemaFieldRepository layerSchemaFieldRepository;
    private final LayerSchemaOptionRepository layerSchemaOptionRepository;

    public List<LayerSchemaField> getSchemaFields() {
        return layerSchemaFieldRepository.findAll();
    }

    public List<LayerSchemaField> getSchemaFieldsBySchemaId(Long nodeId) {
        return layerSchemaFieldRepository.findAllByLayerSchemaId(nodeId);
    }

    public LayerSchemaField findById(Long id) {
        return layerSchemaFieldRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("LayerSchemaField not found, id:::" + id));
    }

    public LayerSchemaField save(LayerSchemaField entity) {
        return layerSchemaFieldRepository.save(entity);
    }

    public void deleteById(Long fieldId) {
        layerSchemaFieldRepository.deleteById(fieldId);
        layerSchemaOptionRepository.deleteAllByFieldId(fieldId);
    }

    public List<LayerSchemaField> findAllByLayerSchema_Layer_IdIn(List<Long> layerIds) {
        return layerSchemaFieldRepository.findAllByLayerSchema_Layer_IdIn(layerIds);
    }
}
