package com.iitp.iitp_rest.model.network.port;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class PortTreeResponse {
    private Long nodeId;
    private PortType type;
    private String linkId;
    private Long direction;

    public PortTreeResponse(Long nodeId, PortType type, String linkId, Long direction) {
        this.nodeId = nodeId;
        this.type = type;
        this.linkId = linkId;
        this.direction = direction;
    }
}
