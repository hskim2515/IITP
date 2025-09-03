package com.iitp.iitp_rest.model.network.link;

import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import lombok.*;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Entity
public class Segment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "segment_id")
    private Long segmentId;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "lane_id", nullable = false)
    @JsonBackReference
    private Lane lane;
    @Column(nullable = false)
    private Long id;
    @Column(nullable = false)
    private Boolean block;
    @Column(nullable = false)
    private double initPoint;
    @Column(nullable = false)
    private double endPoint;
}

