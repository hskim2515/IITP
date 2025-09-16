package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.layer.LayerMapper;
import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.layer.LayerGroup;
import com.iitp.iitp_rest.service.layer.LayerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.iitp.iitp_rest.model.layer.LayerResponse;
import com.iitp.iitp_rest.model.layer.LayerGroupResponse;
import java.util.List;

@RestController
@RequestMapping("/layer")
@RequiredArgsConstructor
public class LayerController {

    private final LayerService layerService;
    private final LayerMapper layerMapper;

    @GetMapping("/list")
    public ResponseEntity<List<LayerResponse>> getAllLayers() {
        List<Layer> layers = layerService.getAllLayers();
        return ResponseEntity.ok(layerMapper.toResponseList(layers));
    }

    @GetMapping("/group")
    public ResponseEntity<List<LayerGroupResponse>> getAllLayerGroup() {
        List<LayerGroup> layerGroups = layerService.getAllLayerGroups();
        return ResponseEntity.ok(layerMapper.toGroupResponseList(layerGroups));
    }

    @GetMapping("/group/{groupKey}")
    public ResponseEntity<LayerGroupResponse> getLayerGroup(@PathVariable String groupKey) {
        return layerService.getLayerGroupByKey(groupKey)
                .map(layerMapper::toGroupResponse)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
