package com.iitp.iitp_rest.model.network.port;

import lombok.Data;

@Data
public class PortResponse {
    private PortType type;
    private String linkId;
    private Long direction;
}
