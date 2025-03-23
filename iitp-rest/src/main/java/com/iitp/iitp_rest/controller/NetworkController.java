package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.Network;
import com.iitp.iitp_rest.repository.NetworkRepository;
import lombok.AllArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;

@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    private final NetworkRepository networkRepository;

    @PostMapping("/save")
    public ResponseEntity<String> saveGeoJson(@RequestBody String geoJson) {
        try {
            JsonNode geojsonNode = new ObjectMapper().readTree(geoJson);  // GeoJSON 문자열을 JsonNode로 변환
            Network network = new Network();
            network.setName("Network 1");
            network.setGeojson(geojsonNode);
            networkRepository.save(network);
            return ResponseEntity.ok("GeoJSON data saved successfully");
        } catch (IOException e) {
            return ResponseEntity.status(500).body("Error parsing GeoJSON data");
        }
    }

    @GetMapping("/get/{id}")
    public ResponseEntity<JsonNode> getGeoJson(@PathVariable Long id) {
        Network network = networkRepository.findById(id).orElse(null);
        if (network == null) {
            return ResponseEntity.status(404).body(null);
        }
        return ResponseEntity.ok(network.getGeojson());  // 저장된 GeoJSON 데이터를 반환
    }
}
