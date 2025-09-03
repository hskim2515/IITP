package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.iitp.iitp_rest.model.network.link.Link;
import jakarta.persistence.*;
import lombok.*;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
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

