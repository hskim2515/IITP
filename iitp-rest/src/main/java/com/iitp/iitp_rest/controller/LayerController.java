package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.layer.LayerGroup;
import com.iitp.iitp_rest.repository.LayerGroupRepository;
import com.iitp.iitp_rest.repository.LayerRepository;
import com.iitp.iitp_rest.service.layer.LayerService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/layers")
public class LayerController {

    private final LayerGroupRepository layerGroupRepository;
    private final LayerRepository layerRepository;

    public LayerController(LayerGroupRepository layerGroupRepository, LayerRepository layerRepository) {
        this.layerGroupRepository = layerGroupRepository;
        this.layerRepository = layerRepository;
    }

    // 특정 그룹 조회
    @GetMapping("/group/{groupKey}")
    public ResponseEntity<LayerGroup> getLayerGroup(@PathVariable String groupKey) {
        LayerGroup group = layerGroupRepository.findByKey(groupKey);
        if (group == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(group);
    }

    // 전체 레이어 조회
    @GetMapping
    public ResponseEntity<List<Layer>> getAllLayers() {
        return ResponseEntity.ok(layerRepository.findAll());
    }

    // 그룹 전체 조회
    @GetMapping("/group")
    public ResponseEntity<List<LayerGroup>> getAllLayerGroup() {
        return ResponseEntity.ok(layerGroupRepository.findAll());
    }
}

