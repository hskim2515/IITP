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
public class LayerSchemaResponse {
    private Long layerId;
    private String layerName;

    private List<SchemaNode> roots;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SchemaNode {

        private Long id;
        private String name;
        private Integer depth;
        private Integer sortOrder;
        private String status;

        private List<SchemaNode> children;

        private List<SchemaField> fields;

    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SchemaField {
        private Long id;
        private String name;
        private String dataType;
        private String inputType;
        private boolean readOnly;
        private boolean nullable;
        private String status;

        private List<SchemaOption> options;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SchemaOption {
        private Long id;
        private String value;
    }
}
