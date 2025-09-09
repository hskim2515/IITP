package com.iitp.iitp_rest.model.schema;

import lombok.Data;

import java.util.List;

@Data
public class SchemaFieldsRequest {
    private Long id;
    private List<CreateFieldRequestDto> fieldsToCreate;
    private List<UpdateFieldRequestDto> fieldsToUpdate;
    private List<Long> fieldIdsToDelete;

    @Data
    public static class CreateFieldRequestDto {
        private String name;
        private Boolean nullable;
        private String defaultValue;
        private Boolean readOnly;
        private String status;
        private String inputType;
        private List<CreateFieldOptionRequestDto> options;
    }

    @Data
    public static class CreateFieldOptionRequestDto {
        private String value;
    }

    @Data
    public static class UpdateFieldRequestDto {
        private Long id;

        private String name;
        private Boolean nullable;
        private String defaultValue;
        private Boolean readOnly;
        private String status;
        private String inputType;
        private List<UpdateFieldOptionDto> options;

        private List<CreateFieldOptionRequestDto> optionsToCreate;
        private List<Long> optionIdsToDelete;
    }

    @Data
    public static class UpdateFieldOptionDto {
        private Long id;
        private String value;
    }
}
