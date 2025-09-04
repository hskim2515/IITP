package com.iitp.iitp_rest.model.network.connection;

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
                @Index(name = "connection_node_id_idx", columnList = "node_id")
        }
)
@Entity
public class Connection {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "connection_id")
    private Long connectionId;
    @Column(nullable = false)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id", nullable = false)
    @JsonBackReference
    private Node node;

    @Column(name = "from_link")
    private Long fromLink;
    @Column(name = "from_lane")
    private Long fromLane;
    @Column(name = "to_link")
    private Long toLink;
    @Column(name = "to_lane")
    private Long toLane;

    @Column(nullable = false)
    private Turning turning;
    @Column(nullable = false)
    private Double length;
    @Column(nullable = false)
    private Double width;
    @Column(nullable = false)
    private Double ffSpd;
    @Column(nullable = false)
    private String shape;
}

