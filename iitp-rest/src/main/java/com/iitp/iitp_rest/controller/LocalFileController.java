package com.iitp.iitp_rest.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@RestController
@RequestMapping("/local-data/models")
@ConditionalOnProperty(name = "storage.type", havingValue = "local", matchIfMissing = true)
public class LocalFileController {

    @Value("${iitp.local.data-path:${user.home}/.iitp-local/models}")
    private String basePath;

    @GetMapping("/**")
    public ResponseEntity<Resource> serve(HttpServletRequest request) {
        String prefix = request.getContextPath() + "/local-data/models/";
        String relativePath = request.getRequestURI().substring(prefix.length());
        Path file = Paths.get(basePath).resolve(relativePath).normalize();

        if (!file.startsWith(Paths.get(basePath)) || !Files.exists(file)) {
            return ResponseEntity.notFound().build();
        }

        String contentType = "application/xml";
        String name = file.getFileName().toString();
        if (name.endsWith(".db"))   contentType = "application/octet-stream";
        if (name.endsWith(".json")) contentType = "application/json";
        if (name.endsWith(".glb") || name.endsWith(".gltf")) contentType = "model/gltf-binary";

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .body(new FileSystemResource(file));
    }
}
