package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.scheme.LayerColScheme;
import com.iitp.iitp_rest.service.scheme.LayerColSchemeService;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/schemes")
public class SchemeController {

    private final LayerColSchemeService service;

    public SchemeController(LayerColSchemeService service) {
        this.service = service;
    }

    @GetMapping("/{layerKey}")
    public List<LayerColScheme> getSchemesByLayerKey(@PathVariable String layerKey) {
        return service.getSchemesByLayerKey(layerKey);
    }

//    @GetMapping("/{rowKey}")
//    public List<LayerColScheme> getSchemesByRowKey(@PathVariable String rowKey) {
//        return service.getSchemesByRowKey(rowKey);
//    }
}

