package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

@Slf4j
@RestController
@RequestMapping("/route")
@RequiredArgsConstructor
public class RouteController {

    private final ObjectMapper objectMapper;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    @GetMapping("/{scenarioKey}")
    public ResponseEntity<Object> getRoute(@PathVariable String scenarioKey) {
        return fetchJson(scenarioKey, "Route.json");
    }

    @GetMapping("/pax/{scenarioKey}")
    public ResponseEntity<Object> getPaxRoute(@PathVariable String scenarioKey) {
        return fetchJson(scenarioKey, "PaxRoute.json");
    }

    private ResponseEntity<Object> fetchJson(String scenarioKey, String fileName) {
        String url = remoteUrl + scenarioKey + "/" + fileName;
        log.info("[RouteController] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            Object json = objectMapper.readValue(is, Object.class);
            return ResponseEntity.ok(json);
        } catch (java.io.FileNotFoundException e) {
            log.warn("[RouteController] 파일 없음: {}/{}", scenarioKey, fileName);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        } catch (IOException e) {
            log.error("[RouteController] 오류", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
