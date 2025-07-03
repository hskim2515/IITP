package com.iitp.iitp_rest.model.pavementMarking;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import com.vladmihalcea.hibernate.type.json.JsonType;
import org.hibernate.annotations.Type;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.Map;

@Entity
@Table(name = "pavement_marking_versions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PavementMarkingVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "version_id", nullable = false)
    private String versionId;

    @Column(name = "created_at", nullable = false, updatable = false)
    @CreationTimestamp
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false, updatable = false)
    @UpdateTimestamp
    private LocalDateTime updatedAt;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> data;
}
