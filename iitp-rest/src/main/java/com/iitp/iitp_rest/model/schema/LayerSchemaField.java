package com.iitp.iitp_rest.model.schema;

import jakarta.persistence.*;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

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
    @Column(name = "sort_order")
    private Integer sortOrder;
    private String inputType;
    private String defaultValue;
    @Column(nullable=false)
    private boolean readOnly;
    @Column(nullable=false)
    private boolean nullable;
    @Column(nullable = false)
    private Status status = Status.ACTIVE;

    @OneToMany(
            mappedBy = "field",
            cascade = {CascadeType.PERSIST, CascadeType.MERGE},
            fetch = FetchType.LAZY
    )
    private List<LayerSchemaOption> options = new ArrayList<>();
}
