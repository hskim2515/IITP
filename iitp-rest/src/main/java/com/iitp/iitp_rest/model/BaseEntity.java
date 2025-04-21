package com.iitp.iitp_rest.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.*;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;

/**
 * 공통 감사 필드 추상 클래스
 */
@Getter
@Setter
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)  // AuditingEntityListener는 @PrePersist/@PreUpdate 호출을 지원합니다 :contentReference[oaicite:1]{index=1}
public abstract class BaseEntity {

    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private String createdBy;

    @CreatedDate
    @Column(
            name = "created_date",
            nullable = false,
            updatable = false,
            columnDefinition = "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"
    )
    private Instant createdDate;

    @LastModifiedBy
    @Column(name = "last_modified_by")
    private String lastModifiedBy;

    @LastModifiedDate
    @Column(
            name = "last_modified_date",
            nullable = false,
            columnDefinition = "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"
    )
    private Instant lastModifiedDate;

    /**
     * INSERT 시점에 한 번만 호출되어 createdDate/lastModifiedDate를 채웁니다.
     * JPA @PrePersist 콜백 메서드는 매개변수 없이 void 반환 타입이어야 합니다. :contentReference[oaicite:2]{index=2}
     */
    @PrePersist  // INSERT 직전에 호출됩니다 :contentReference[oaicite:3]{index=3}
    protected void onCreate() {
        Instant now = Instant.now();  // Instant는 UTC 기반 절대 시점을 나타냅니다 :contentReference[oaicite:4]{index=4}
        this.createdDate = now;
        this.lastModifiedDate = now;
    }

    /**
     * UPDATE 시마다 호출되어 lastModifiedDate를 갱신합니다.
     */
    @PreUpdate  // UPDATE 직전에 호출됩니다 :contentReference[oaicite:5]{index=5}
    protected void onUpdate() {
        this.lastModifiedDate = Instant.now();
    }
}
