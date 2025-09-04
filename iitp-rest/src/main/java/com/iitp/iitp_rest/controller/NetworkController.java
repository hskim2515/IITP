package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.network.NetworkXmlResponse;
import com.iitp.iitp_rest.model.network.RoadResponse;
import com.iitp.iitp_rest.service.network.NetworkService;
import com.iitp.iitp_rest.service.network.RoadService;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.AllArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.xml.stream.XMLStreamException;
import java.io.InputStream;


@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    private final NetworkService networkService;
    private final RoadService roadService;

    @GetMapping("/{key}")
    public ResponseEntity<NetworkXmlResponse> getNetwork(@PathVariable String key) {
        try {
            String path = key + "/network.xml";
            InputStream is = XmlUtils.loadXmlAsStream(path);
            NetworkXmlResponse dto = networkService.streamToDto(is);
            NetworkXmlResponse result = networkService.transformNetworkCoordinates(key, dto);
            return ResponseEntity.ok(result);
        } catch (XMLStreamException e) {
            return ResponseEntity.status(500).body(new NetworkXmlResponse());
        }
    }

    @GetMapping("/road/{key}")
    public ResponseEntity<RoadResponse> getRoad(@PathVariable String key) {
        try {
            String path = key + "/network.xml";
            InputStream is = XmlUtils.loadXmlAsStream(path);
            RoadResponse result = roadService.streamToDto(is);

            return ResponseEntity.ok(result);
        } catch (XMLStreamException e) {
            return ResponseEntity.status(500).body(new RoadResponse());
        }
    }

}
