package com.iitp.iitp_rest.model.xmllayer;

import com.iitp.iitp_rest.model.LogsData;
import com.vladmihalcea.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.Type;

import java.time.LocalDateTime;

@Entity
@Table(name = "xml_layer_logs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class XmlLayerLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "layer_key", nullable = false, length = 100)
    private String layerKey;

    @Column(name = "version_id", nullable = false, length = 200)
    private String versionId;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private LogsData data;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
