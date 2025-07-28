package com.iitp.iitp_rest.model;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.Type;

import java.time.LocalDateTime;

@Entity
@Data
@Table(name = "vehicle_route")
public class VehicleRoute {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "version_id")
    private String versionId;

    @Column(columnDefinition = "text")
    private String czml;

    @Column(columnDefinition = "text")
    private String features;

    @Column(columnDefinition = "text")
    private String positions;

    @Column(name = "insert_date")
    private LocalDateTime insertDate = LocalDateTime.now();
}


