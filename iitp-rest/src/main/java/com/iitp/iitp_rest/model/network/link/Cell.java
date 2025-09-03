package com.iitp.iitp_rest.model.network.link;

import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import lombok.*;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Entity
public class Cell {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "cell_id")
    private Long cellId;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "lane_id", nullable = false)
    @JsonBackReference
    private Lane lane;
    @Column(nullable = false)
    private Long id;
    @Column(nullable = false)
    private double length;
    @Column(name = "\"offset\"", nullable = false)
    private double offset;

}

