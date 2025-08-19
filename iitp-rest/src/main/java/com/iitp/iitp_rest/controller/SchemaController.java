package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.schema.LayerSchemaResponse;
import com.iitp.iitp_rest.service.schema.SchemaService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/schema")
@RequiredArgsConstructor
public class SchemaController {

    private final SchemaService schemeService;

    @GetMapping("/{layerKey}")
    public ResponseEntity<LayerSchemaResponse> getSchemaByLayerKey(@PathVariable("layerKey") String layerKey) {
        LayerSchemaResponse result = schemeService.getSchemaByLayerKey(layerKey);
        return ResponseEntity.ok(result);
    }
    @GetMapping("")
    public ResponseEntity<List<LayerSchemaResponse>> getSchemata() {
        List<LayerSchemaResponse> result = schemeService.getSchemata();
        return ResponseEntity.ok(result);
    }
}

