package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonManagedReference;
import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.connection.Connection;
import com.iitp.iitp_rest.model.network.port.Port;
import jakarta.persistence.*;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Entity
public class Node {
    @Id
    private Long id;
    @Builder.Default
    @OneToMany(mappedBy = "node", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Connection> connections = new ArrayList<>();
    @Builder.Default
    @OneToMany(mappedBy = "node", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Port> ports = new ArrayList<>();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "network_id", nullable = false)
    @JsonBackReference
    private Network network;
    @Column(length = 16, nullable = false)
    private NodeType type;
    @Column(length = 4, nullable = true)
    private V2x v2x = V2x.off;
    @Column(nullable = false)
    private Integer numPort;
    @Column(nullable = false)
    private Integer numConnection;
    @Column(nullable = false)
    private String center;

    public void addPort(Port port) {
        this.ports.add(port);
        port.setNode(this);
    }

    public void addConnection(Connection connection) {
        this.connections.add(connection);
        connection.setNode(this);
    }
}
