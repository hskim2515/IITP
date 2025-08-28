package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.schema.LayerSchemaResponse;
import com.iitp.iitp_rest.model.schema.SchemaFieldsRequest;
import com.iitp.iitp_rest.service.schema.SchemaService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/schema")
@RequiredArgsConstructor
public class SchemaController {

    private final SchemaService schemeService;

    @GetMapping("/{layer-key}")
    public ResponseEntity<LayerSchemaResponse> getSchemaByLayerKey(@PathVariable("layer-key") String layerKey) {
        LayerSchemaResponse result = schemeService.getSchemaByLayerKey(layerKey);
        return ResponseEntity.ok(result);
    }
    @GetMapping("")
    public ResponseEntity<List<LayerSchemaResponse>> getSchemata() {
        List<LayerSchemaResponse> result = schemeService.getSchemata();
        return ResponseEntity.ok(result);
    }
    @PostMapping("/{layer-key}")
    public ResponseEntity<Void> updateSchemata(@PathVariable("layer-key") String layerKey, @RequestBody List<SchemaFieldsRequest> dtos) {
        log.info("[updateSchemata] layerKey: {} \nSchemaFieldsRequest: {}", layerKey, dtos);
        try {
            schemeService.updateSchemata(layerKey, dtos);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}

