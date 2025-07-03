package com.iitp.iitp_rest.controller;
import com.iitp.iitp_rest.model.pavementMarking.GeojsonSaveRequest;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import com.iitp.iitp_rest.model.pavementMarking.UpdateLog;
import com.iitp.iitp_rest.service.pavementMarking.PavementMarkingService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/pavement-marking")
public class PavementMarkingController {

    private final PavementMarkingService pavementMarkingService;

    public PavementMarkingController(PavementMarkingService pavementMarkingService) {
        this.pavementMarkingService = pavementMarkingService;
    }

    @GetMapping("/geojson/{versionId}")
    public ResponseEntity<Map<String, Object>> getJsonByVersion(@PathVariable String versionId) {

        PavementMarkingVersion version = pavementMarkingService.getByVersionId(versionId);
        Map<String, Object> json = version.getData();

        return ResponseEntity.ok(Collections.singletonMap("geojson", json));
    }

    @GetMapping("/historys/{versionId}")
    public ResponseEntity<List<Map<String, Object>>> getLogsByVersion(@PathVariable String versionId) {
        List<PavementMarkingLogs> versions = pavementMarkingService.getLogsByVersion(versionId);

        List<Map<String, Object>> result = versions.stream().map(v -> {
            Map<String, Object> map = new HashMap<>();
            map.put("id", v.getId());
            map.put("versionId", v.getVersionId());
            map.put("createdAt", v.getCreatedAt());
            map.put("json", v.getData());
            return map;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(result);
    }

    @PostMapping("/geojson/{versionId}")
    public ResponseEntity<Void> savePavementMarking (@RequestBody GeojsonSaveRequest request) {
        try {
            String versionId = String.valueOf(request.getVersionId());
            Map<String, Object> geojson = request.getGeojson();
            List<UpdateLog> logs = request.getLogJson();

            pavementMarkingService.savePavementMarking(versionId, geojson, logs);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

}