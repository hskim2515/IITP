package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.connection.ConnectionResponse;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NodeResponse {
    private Long id;
    private NodeType type;
    private int numPort;
    private int numConnection;
    private V2x v2x;
    private String center;
    /** 교차로 명칭 (원본 NODE_NAME 유래, 옵셔널) */
    private String name;

    private List<PortResponse> ports = new ArrayList<>();
    private List<ConnectionResponse> connections = new ArrayList<>();

    private Coordinates coordinates;
    private List<String> portLinkIds = new ArrayList<>();
}
