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
    /** 네트워크 기준점 캘리브레이션 회전각(도) — network.xml의 base_rotation 미러. null=0(회전 없음).
     *  차량 시뮬레이션(CoordinateConverter)이 네트워크와 동일한 위치·회전·축척으로 계산되도록 동기화. */
    private Double baseRotation;
    /** 네트워크 기준점 캘리브레이션 축척 — network.xml의 base_scale 미러. null=1(원본 크기). */
    private Double baseScale;

    private String label;
    private String description;

    @OneToMany(mappedBy = "scenario", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ScenarioVersion> versions;
}