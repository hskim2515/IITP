package com.iitp.iitp_rest.model.schema.column;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LayerSchemaColumn {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "column_key", nullable = false)
    private String columnKey;
    @Column(name = "input_type", nullable = false)
    private String inputType;
    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;
}
