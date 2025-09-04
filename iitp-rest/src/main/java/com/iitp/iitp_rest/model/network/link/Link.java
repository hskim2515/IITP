package com.iitp.iitp_rest.model.network.link;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonManagedReference;
import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.lane.Lane;
import jakarta.persistence.*;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Entity
public class Link {
    @Id
    private Long id;
    @Builder.Default
    @OneToMany(mappedBy = "link", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Lane> lanes = new ArrayList<>();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "network_id", nullable = false)
    @JsonBackReference
    private Network network;
    @Column(nullable = false)
    private Long fromNode;
    @Column(nullable = false)
    private Long toNode;
    @Column(nullable = false)
    private int numLane;
    @Column(nullable = false)
    private double length;
    @Column(nullable = false)
    private double width;
    @Column(nullable = false)
    private double minSpd;
    @Column(nullable = false)
    private double maxSpd;
    @Column(nullable = false)
    private double ffSpd;
    @Column(nullable = false)
    private double waveSpd;
    @Column(nullable = false)
    private double qmax;
    @Column(nullable = false)
    private double maxVeh;
    @Column(nullable = false)
    private SimType simType;
    @Column(nullable = false)
    private LinkType type;
    @Column(nullable = false)
    private String layer;
    @Column(nullable = false)
    private double stopLine;
    @Column(nullable = false)
    private String shape;

    public void addLane(Lane lane) {
        this.lanes.add(lane);
        lane.setLink(this);
    }
}

