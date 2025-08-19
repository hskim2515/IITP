package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.schema.LayerSchema;
import com.iitp.iitp_rest.repository.LayerSchemaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class LayerSchemaService {

    private final LayerSchemaRepository layerSchemaRepository;


    public List<LayerSchema> getSchemata() {
        return layerSchemaRepository.findAll();
    }

    public List<LayerSchema> getSchemaByLayerId(Long layerId) {
        return layerSchemaRepository.findAllByLayerId(layerId);
    }

    public LayerSchema getSchemaById(Long id) {
        return layerSchemaRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("LayerSchema not found, id:::" + id));
    }
    public LayerSchema save(LayerSchema entity) {
        return layerSchemaRepository.save(entity);
    }




}