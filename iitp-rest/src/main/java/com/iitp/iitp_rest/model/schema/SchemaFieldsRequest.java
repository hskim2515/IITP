package com.iitp.iitp_rest.model.schema;

import lombok.Data;

import java.util.List;

@Data
public class SchemaFieldsRequest {
    private Long id;
    private List<CreateFieldRequest> fieldsToCreate;
    private List<UpdateFieldRequest> fieldsToUpdate;
    private List<Long> fieldIdsToDelete;

    @Data
    public static class CreateFieldRequest {
        private String name;
        private Boolean nullable;
        private String defaultValue;
        private Boolean readOnly;
        private Status status;
        private String inputType;
        private List<CreateFieldOptionRequest> options;
    }

    @Data
    public static class CreateFieldOptionRequest {
        private String value;
    }

    @Data
    public static class UpdateFieldRequest {
        private Long id;

        private String name;
        private Boolean nullable;
        private String defaultValue;
        private Boolean readOnly;
        private Status status;
        private String inputType;
        private List<UpdateFieldOption> options;

        private List<CreateFieldOptionRequest> optionsToCreate;
        private List<Long> optionIdsToDelete;
    }

    @Data
    public static class UpdateFieldOption {
        private Long id;
        private String value;
    }
}
