package com.iitp.iitp_rest.service.layer;

import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.repository.LayerRepository;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class LayerService {

    private final LayerRepository layerRepository;

    public LayerService(LayerRepository layerRepository) {
        this.layerRepository = layerRepository;
    }

    public List<Layer> getLayersByGroupKey(String groupKey) {
        return layerRepository.findByGroup_Key(groupKey);
    }
}

