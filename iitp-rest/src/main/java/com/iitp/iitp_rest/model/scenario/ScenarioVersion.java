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

    @Column(name = "insert_date", nullable = false)
    private LocalDateTime insertDate;

    @Column(name = "modify_date")
    private LocalDateTime modifyDate;

    private Double latitude;
    private Double longitude;
    /** 네트워크 기준점 캘리브레이션 회전각(도) — 이 버전의 network.xml base_rotation 미러. null=버전 자체 캘리브레이션 없음(부모 Scenario 값 사용). */
    private Double baseRotation;
    /** 네트워크 기준점 캘리브레이션 축척 — 이 버전의 network.xml base_scale 미러. null=버전 자체 캘리브레이션 없음(부모 Scenario 값 사용). */
    private Double baseScale;

    /**
     * 버전 자체 좌표(캘리브레이션 결과)가 있으면 그 값으로, 없으면 부모 Scenario 값 그대로 반환한다.
     * 같은 Scenario의 다른 버전을 캘리브레이션해도 이 버전의 값이 섞이지 않도록 스냅샷을 새로 만든다
     * (DB에 저장하지 않는 일회성 조회용 객체 — Scenario.latitude/baseRotation 등이 여러
     * ScenarioVersion 간 공유되어 한 버전의 캘리브레이션이 다른 버전에 새는 문제를 막는다).
     */
    public Scenario toEffectiveScenario() {
        if (scenario == null) return null;
        if (latitude == null || longitude == null) return scenario;
        return Scenario.builder()
                .id(scenario.getId())
                .key(scenario.getKey())
                .label(scenario.getLabel())
                .description(scenario.getDescription())
                .latitude(latitude)
                .longitude(longitude)
                .baseRotation(baseRotation)
                .baseScale(baseScale)
                .build();
    }
}
