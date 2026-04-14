package com.iitp.iitp_rest.service.network;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.signal.SignalResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

/**
 * iitp-ml 서비스 호출: 표준노드링크 bbox 필터링 → NetworkResponse
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AutoNetworkService {

    @Value("${iitp.ml.url:http://localhost:8000}")
    private String mlServiceUrl;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    private final RestTemplate restTemplate = new RestTemplate();

    public record AutoNetworkResult(NetworkResponse network, List<SignalResponse> signals, String stats) {}

    public AutoNetworkResult generate(
            double south, double west, double north, double east
    ) throws Exception {

        String url = mlServiceUrl + "/auto-network/generate";

        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("south", String.valueOf(south));
        body.add("west",  String.valueOf(west));
        body.add("north", String.valueOf(north));
        body.add("east",  String.valueOf(east));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(body, headers);

        log.info("iitp-ml 호출: bbox=({},{},{},{})", south, west, north, east);
        ResponseEntity<String> response = restTemplate.postForEntity(url, request, String.class);

        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            throw new RuntimeException("iitp-ml 서비스 오류: " + response.getStatusCode());
        }

        JsonNode root    = objectMapper.readTree(response.getBody());
        JsonNode network = root.get("network");
        JsonNode stats   = root.get("stats");

        NetworkResponse networkResponse = parseNetworkResponse(network);

        // signals 파싱 (정밀도로지도 모드에서만 존재, 없으면 빈 리스트)
        List<SignalResponse> signals = new ArrayList<>();
        JsonNode signalsNode = network.get("signals");
        if (signalsNode != null && signalsNode.isArray()) {
            for (JsonNode s : signalsNode) {
                signals.add(objectMapper.treeToValue(s, SignalResponse.class));
            }
        }

        String statsStr = stats != null ? stats.toString() : "{}";
        log.info("자동 네트워크 생성 완료: 노드 {}개, 링크 {}개, 신호 {}개",
                networkResponse.getNodes().size(), networkResponse.getLinks().size(), signals.size());

        return new AutoNetworkResult(networkResponse, signals, statsStr);
    }

    private NetworkResponse parseNetworkResponse(JsonNode network) throws Exception {
        NetworkResponse response = new NetworkResponse();

        if (network.has("nodes")) {
            List<NodeResponse> nodes = new ArrayList<>();
            for (JsonNode n : network.get("nodes")) {
                nodes.add(objectMapper.treeToValue(n, NodeResponse.class));
            }
            response.setNodes(nodes);
        }

        if (network.has("links")) {
            List<LinkResponse> links = new ArrayList<>();
            for (JsonNode l : network.get("links")) {
                links.add(objectMapper.treeToValue(l, LinkResponse.class));
            }
            response.setLinks(links);
        }

        return response;
    }
}
