package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.schema.LayerSchemaOption;
import com.iitp.iitp_rest.repository.LayerSchemaOptionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class LayerSchemaOptionService {
    private final LayerSchemaOptionRepository layerSchemaOptionRepository;

    public List<LayerSchemaOption> getSchemaOptions() {
        return layerSchemaOptionRepository.findAll();
    }

    public List<LayerSchemaOption> getSchemaOptionsByField(Long fieldId) {
        return layerSchemaOptionRepository.findAllByFieldId(fieldId);
    }
    public LayerSchemaOption getSchemaOptionById(Long id) {
        return layerSchemaOptionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("LayerSchemaOption not found, id:::" + id));
    }

    public LayerSchemaOption save(LayerSchemaOption entity) {
        return layerSchemaOptionRepository.save(entity);
    }
}
