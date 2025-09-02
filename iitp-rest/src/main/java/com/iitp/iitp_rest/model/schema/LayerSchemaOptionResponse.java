package com.iitp.iitp_rest.model.schema;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LayerSchemaOptionResponse {
    private Long id;
    private String value;
}
