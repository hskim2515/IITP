package com.iitp.iitp_rest.service.layer;

import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.layer.LayerGroup;
import com.iitp.iitp_rest.repository.LayerGroupRepository;
import com.iitp.iitp_rest.repository.LayerRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class LayerService {

    private final LayerRepository layerRepository;
    private final LayerGroupRepository layerGroupRepository;

    public Optional<LayerGroup> getLayerGroupByKey(String groupKey) {
        return Optional.ofNullable(layerGroupRepository.findByKey(groupKey));
    }

    public List<Layer> getAllLayers() {
        return layerRepository.findAll();
    }

    public List<LayerGroup> getAllLayerGroups() {
        return layerGroupRepository.findAll();
    }
}