package com.iitp.iitp_rest.model.ktdb;

import jakarta.persistence.*;
import lombok.Getter;

@Getter
@Entity
@Table(name = "ktdb_node")
public class KtdbNode {

    @Id
    @Column(name = "node_id", length = 20)
    private String nodeId;

    @Column(nullable = false)
    private double lon;

    @Column(nullable = false)
    private double lat;
}
