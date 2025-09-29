package com.iitp.iitp_rest.model.schema;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LayerSchemaFieldResponse {
    private Long id;
    private String name;
//    private Integer sortOrder;
    private String inputType;
    private String defaultValue;
    private boolean readOnly;
    private boolean nullable;
    private Status status;

    private List<LayerSchemaOptionResponse> options;
}
