package com.iitp.iitp_rest.model.schema;

import com.fasterxml.jackson.annotation.JsonManagedReference;
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

    private List<SchemaColumn> schemaColumns;

    private List<SchemaDefinition> definition;

    private List<SchemaStructure> structure;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SchemaDefinition {

        private Long id;
        private String name;
        //        private Integer sortOrder;
        private String status;

        private List<LayerSchemaFieldResponse> fields;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SchemaColumn {
        private String configKey;
        private String inputType;
//        private Integer sortOrder;

        private List<ColumnOption> options;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ColumnOption {
        private String value;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SchemaStructure {
        String name;
        @JsonManagedReference
        private List<SchemaStructure> children;
    }
}
