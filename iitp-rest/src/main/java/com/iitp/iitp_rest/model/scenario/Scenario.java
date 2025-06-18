package com.iitp.iitp_rest.model.scenario;

import jakarta.persistence.*;
import lombok.*;

import java.util.List;

@Entity
@Table(name = "scenario")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Scenario {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String key;

    private Double longitude;
    private Double latitude;

    private String label;
    private String description;

    @OneToMany(mappedBy = "scenario", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ScenarioVersion> versions;
}