package com.iitp.iitp_rest.model.scenario;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "scenario_version")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ScenarioVersion {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "scenario_id", nullable = false)
    @JsonIgnore
    private Scenario scenario;

    @Column(nullable = false)
    private String key;

    @Column(nullable = false)
    private String label;

    @Column(name = "data_path")
    private String dataPath;

    @Column(name = "insert_date", nullable = false)
    private LocalDateTime insertDate;

    @Column(name = "modify_date")
    private LocalDateTime modifyDate;
}
