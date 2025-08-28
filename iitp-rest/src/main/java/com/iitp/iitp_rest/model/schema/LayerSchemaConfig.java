package com.iitp.iitp_rest.model.schema;

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
public class LayerSchemaConfig {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "config_key", nullable = false)
    private String configKey;
    @Column(name = "input_type", nullable = false)
    private String inputType;
    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;
}
