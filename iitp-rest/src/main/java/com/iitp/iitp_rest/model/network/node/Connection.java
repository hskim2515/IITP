package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.iitp.iitp_rest.model.network.link.Lane;
import com.iitp.iitp_rest.model.network.link.Link;
import jakarta.persistence.*;
import lombok.*;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
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

