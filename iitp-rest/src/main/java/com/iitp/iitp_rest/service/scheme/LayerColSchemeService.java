package com.iitp.iitp_rest.service.scheme;

import com.iitp.iitp_rest.model.scheme.LayerColScheme;
import com.iitp.iitp_rest.repository.LayerColSchemeRepository;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class LayerColSchemeService {

    private final LayerColSchemeRepository repository;

    public LayerColSchemeService(LayerColSchemeRepository repository) {
        this.repository = repository;
    }

    public List<LayerColScheme> getSchemesByLayerKey(String layerKey) {
        return repository.findByLayerKey(layerKey);
    }

    public List<LayerColScheme> getSchemesByRowKey(String rowKey) {
        return repository.findByRowKey(rowKey);
    }
}
