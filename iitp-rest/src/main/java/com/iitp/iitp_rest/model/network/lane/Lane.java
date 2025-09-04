package com.iitp.iitp_rest.model.network.lane;

import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonManagedReference;
import com.iitp.iitp_rest.model.network.cell.Cell;
import com.iitp.iitp_rest.model.network.link.Link;
import com.iitp.iitp_rest.model.network.segment.Segment;
import jakarta.persistence.*;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Table(indexes = {
        @Index(name = "lane_link_id_idx", columnList = "link_id")
})
@Entity
public class Lane {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long laneId;
    @Builder.Default
    @OneToMany(mappedBy = "lane", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Cell> cells = new ArrayList<>();
    @Builder.Default
    @OneToMany(mappedBy = "lane", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Segment> segments = new ArrayList<>();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "link_id", nullable = false)
    @JsonBackReference
    private Link link;
    @Column(nullable = false)
    private Long id;
    @Column(nullable = false)
    private String leftLaneId;
    @Column(nullable = false)
    private String rightLaneId;
    @Column(nullable = false)
    private int numCell;
    @Column(nullable = false)
    private String laneAccessType;
    @Column(nullable = false)
    private Boolean rightLC;
    @Column(nullable = false)
    private Boolean leftLC;
    @Column(nullable = false)
    private String shape;

    public void addCell(Cell cell) {
        this.cells.add(cell);
        cell.setLane(this);
    }

    public void addSegment(Segment segment) {
        this.segments.add(segment);
        segment.setLane(this);
    }
}

