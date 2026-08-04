package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.service.vehicle.VehicleConfigFileService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/vehicle-config")
@RequiredArgsConstructor
public class VehicleConfigController {

    private final VehicleConfigFileService vehicleConfigFileService;
    private final ObjectMapper objectMapper;

    @GetMapping("/{versionId}")
    public ResponseEntity<?> getConfiguration(@PathVariable String versionId) {
        try {
            return ResponseEntity.ok(vehicleConfigFileService.load(versionId));
        } catch (Exception exception) {
            return ResponseEntity.internalServerError()
                    .body("차량 설정 XML을 읽지 못했습니다: " + exception.getMessage());
        }
    }

    @PutMapping(value = "/{versionId}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> saveConfiguration(
            @PathVariable String versionId,
            @RequestPart("configuration") String configurationJson,
            @RequestPart(value = "file", required = false) MultipartFile file) {
        try {
            VehicleConfigFileService.SaveRequest request = objectMapper.readValue(
                    configurationJson,
                    VehicleConfigFileService.SaveRequest.class);
            return ResponseEntity.ok(vehicleConfigFileService.save(versionId, request, file));
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(exception.getMessage());
        } catch (Exception exception) {
            return ResponseEntity.internalServerError()
                    .body("차량 설정 XML 저장에 실패했습니다: " + exception.getMessage());
        }
    }

    @GetMapping("/{versionId}/models/{fileName:.+}")
    public ResponseEntity<?> getModel(
            @PathVariable String versionId,
            @PathVariable String fileName) {
        try {
            byte[] bytes = vehicleConfigFileService.readModel(versionId, fileName);
            return ResponseEntity.ok()
                    .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic())
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + fileName + "\"")
                    .contentType(MediaType.parseMediaType("model/gltf-binary"))
                    .body(bytes);
        } catch (IOException exception) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(exception.getMessage());
        }
    }
}
