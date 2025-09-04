package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.network.connection.ConnectionResponse;
import com.iitp.iitp_rest.model.network.connection.ConnectionTreeResponse;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import com.iitp.iitp_rest.model.network.port.PortTreeResponse;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
public class NodeTreeResponse {

    private Long id;
    private NodeType type;
    private V2x v2x = V2x.off;
    private Integer numPort;
    private Integer numConnection;
    private String center;
    private List<ConnectionTreeResponse> connections = new ArrayList<>();
    private List<PortTreeResponse> ports = new ArrayList<>();

    public NodeTreeResponse(Long id, NodeType type, V2x v2x, Integer numPort, Integer numConnection, String center) {
        this.id = id;
        this.type = type;
        this.v2x = v2x;
        this.numPort = numPort;
        this.numConnection = numConnection;
        this.center = center;
    }

    public void addPort(PortTreeResponse port) {
        this.ports.add(port);
    }

    public void addConnection(ConnectionTreeResponse connection) {
        this.connections.add(connection);
    }
}
