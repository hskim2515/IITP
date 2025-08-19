package com.iitp.iitp_rest.model.schema;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LayerSchemaField {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "layer_schema_id")
    private LayerSchema layerSchema;

    private String name;
    private String inputType;
    @Column(nullable=false)
    private boolean readOnly;
    @Column(nullable=false)
    private boolean nullable;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.ACTIVE;
}
