package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.threedtiles.ThreedTilesetRequest;
import com.iitp.iitp_rest.model.threedtiles.ThreedTilesetResponse;
import com.iitp.iitp_rest.service.ThreedTilesetService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/threed-tileset")
@RequiredArgsConstructor
public class ThreedTilesetController {

    private final ThreedTilesetService service;

    @GetMapping
    public ResponseEntity<List<ThreedTilesetResponse>> getAll() {
        return ResponseEntity.ok(service.getAll());
    }

    @PostMapping
    public ResponseEntity<ThreedTilesetResponse> create(@RequestBody ThreedTilesetRequest req) {
        return ResponseEntity.ok(service.create(req));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ThreedTilesetResponse> update(@PathVariable Long id, @RequestBody ThreedTilesetRequest req) {
        return ResponseEntity.ok(service.update(id, req));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
