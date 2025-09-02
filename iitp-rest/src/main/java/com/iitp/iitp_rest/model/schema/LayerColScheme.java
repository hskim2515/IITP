package com.iitp.iitp_rest.model.schema;

import com.vladmihalcea.hibernate.type.array.StringArrayType;
import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.Type;

@Entity
@Data
@Table(name = "layer_col_scheme")
public class LayerColScheme {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "row_key")
    private String rowKey;

    @Column(name = "layer_key")
    private String layerKey;

    @Column(name = "key")
    private String key;

    private Boolean readonly;
    private String type;

    @Column(name = "options", columnDefinition = "text[]")
    @Type(StringArrayType.class)
    private String[] options;
}

