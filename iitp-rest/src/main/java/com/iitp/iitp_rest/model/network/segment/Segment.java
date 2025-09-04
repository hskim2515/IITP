package com.iitp.iitp_rest.model.network.segment;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.iitp.iitp_rest.model.network.lane.Lane;
import jakarta.persistence.*;
import lombok.*;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Table(indexes = {
        @Index(name = "segment_lane_id_idx", columnList = "lane_id")
})
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

