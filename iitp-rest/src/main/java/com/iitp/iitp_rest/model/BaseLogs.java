package com.iitp.iitp_rest.model;

import com.vladmihalcea.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import lombok.experimental.SuperBuilder;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.Type;

import java.time.LocalDateTime;
import java.util.Map;


@Getter
@Setter
@MappedSuperclass
@NoArgsConstructor
@AllArgsConstructor
@SuperBuilder
public abstract class BaseLogs {

    @Column(name = "version_id", nullable = false)
    private String versionId;

    @Column(name = "created_at", nullable = false, updatable = false)
    @CreationTimestamp
    private LocalDateTime createdAt;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> data;

}
