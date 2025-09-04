package com.iitp.iitp_rest.model.network.port;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.iitp.iitp_rest.model.network.node.Node;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Table(
        indexes = {
                @Index(name = "port_node_id_idx", columnList = "node_id")
        }
)
@Entity
public class Port {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "link_id")
    private String linkId;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id", nullable = false)
    @JsonBackReference
    private Node node;
    @Column(nullable = false)
    private Long direction;
    @Column(nullable = false)
    private PortType type;
}

