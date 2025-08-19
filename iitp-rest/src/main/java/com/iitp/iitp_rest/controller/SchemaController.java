package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.schema.LayerSchemaResponse;
import com.iitp.iitp_rest.service.schema.LayerSchemaService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/schema")
@RequiredArgsConstructor
public class SchemaController {

    private final LayerSchemaService layerSchemeService;

    @GetMapping("/{layerId}")
    public ResponseEntity<LayerSchemaResponse> getSchemaByLayerKey(@PathVariable("layerId") Long layerId) {
        LayerSchemaResponse result = layerSchemeService.getSchema(layerId);
        return ResponseEntity.ok(result);
    }
    @GetMapping("")
    public ResponseEntity<List<LayerSchemaResponse>> getSchemata() {
        List<LayerSchemaResponse> result = layerSchemeService.getSchemata();
        return ResponseEntity.ok(result);
    }
}

