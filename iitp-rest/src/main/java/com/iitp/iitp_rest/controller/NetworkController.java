package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.service.network.NetworkService;
import lombok.AllArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    private final NetworkService networkService;
    private final NetworkMapper networkMapper;

    @GetMapping("/{versionId}")
    public ResponseEntity<NetworkResponse> getNetworkByScenarioKey(@PathVariable String versionId) {
        NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
        NetworkResponse body = networkMapper.toResponse(xml);
        return ResponseEntity.ok(body);
    }

}
