package com.iitp.iitp_rest.mapper.schema;

import com.iitp.iitp_rest.model.schema.*;
import com.iitp.iitp_rest.model.schema.column.LayerSchemaColumn;
import com.iitp.iitp_rest.model.schema.column.LayerSchemaColumnOption;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

@Component
public class SchemaMapper {

    /**
     * 조회된 모든 엔티티 데이터를 받아 최종 LayerSchemaResponse DTO로 조립
     */
    public LayerSchemaResponse toLayerSchemaResponse(Long layerId, String layerKey, List<LayerSchema> schemata, List<LayerSchemaField> fields, List<LayerSchemaOption> options, List<LayerSchemaColumn> columns, List<LayerSchemaColumnOption> columnOptions) {

        // 데이터를 구조화하기 위해 ID를 기준으로 Map으로 변환
        Map<Long, List<LayerSchemaField>> fieldsBySchemaId = fields.stream()
                .collect(Collectors.groupingBy(field -> field.getLayerSchema().getId()));
        Map<Long, List<LayerSchemaOption>> optionsByFieldId = options.stream()
                .collect(Collectors.groupingBy(option -> option.getField().getId()));
        Map<Long, List<LayerSchemaColumnOption>> columnOptionsByColumnId = columnOptions.stream()
                .collect(Collectors.groupingBy(option -> option.getDefinition().getId()));

        // 각 엔티티를 DTO로 변환
        List<LayerSchemaResponse.Schema> schemaDtos = schemata.stream()
                .map(schema -> toSchemaDto(schema, fieldsBySchemaId, optionsByFieldId))
                .toList();

        List<LayerSchemaResponse.SchemaColumn> schemaColumnDtos = columns.stream()
                .map(column -> toSchemaColumnDto(column, columnOptionsByColumnId))
                .toList();

        return LayerSchemaResponse.builder()
                .layerId(layerId)
                .layerName(layerKey)
                .schemata(schemaDtos)
                .schemaColumns(schemaColumnDtos)
                .build();
    }

    /**
     * LayerSchema 엔티티를 Schema DTO로 변환
     */
    private LayerSchemaResponse.Schema toSchemaDto(LayerSchema schema, Map<Long, List<LayerSchemaField>> fieldsBySchemaId, Map<Long, List<LayerSchemaOption>> optionsByFieldId) {
        List<LayerSchemaField> fieldsForThisSchema = fieldsBySchemaId.getOrDefault(schema.getId(), Collections.emptyList());

        List<LayerSchemaFieldResponse> fieldDtos = fieldsForThisSchema.stream()
                .map(field -> toSchemaFieldDto(field, optionsByFieldId))
                .toList();

        return LayerSchemaResponse.Schema.builder()
                .id(schema.getId())
                .name(schema.getName())
                .status(getEnumNameSafe(schema.getStatus()))
                .fields(fieldDtos)
                .build();
    }

    /**
     * LayerSchemaField 엔티티를 SchemaField DTO로 변환
     */
    private LayerSchemaFieldResponse toSchemaFieldDto(LayerSchemaField field, Map<Long, List<LayerSchemaOption>> optionsByFieldId) {
        List<LayerSchemaOption> optionsForThisField = optionsByFieldId.getOrDefault(field.getId(), Collections.emptyList());

        List<LayerSchemaOptionResponse> optionDtos = optionsForThisField.stream()
                .map(this::toSchemaOptionDto)
                .toList();

        return LayerSchemaFieldResponse.builder()
                .id(field.getId())
                .name(field.getName())
                .inputType(field.getInputType())
                .readOnly(field.isReadOnly())
                .status(getEnumNameSafe(field.getStatus()))
                .options(optionDtos)
                .build();
    }

    /**
     * LayerSchemaOption 엔티티를 SchemaOption DTO로 변환
     */
    private LayerSchemaOptionResponse toSchemaOptionDto(LayerSchemaOption option) {
        return LayerSchemaOptionResponse.builder()
                .id(option.getId())
                .value(option.getValue())
                .build();
    }

    /**
     * LayerSchemaColumn 엔티티를 SchemaColumn DTO로 변환
     */
    private LayerSchemaResponse.SchemaColumn toSchemaColumnDto(LayerSchemaColumn column, Map<Long, List<LayerSchemaColumnOption>> columnOptionsByColumnId) {
        List<LayerSchemaColumnOption> optionsForThisColumn = columnOptionsByColumnId.getOrDefault(column.getId(), Collections.emptyList());

        List<LayerSchemaResponse.ColumnOption> optionDtos = optionsForThisColumn.stream()
                .map(this::toColumnOptionDto)
                .toList();

        return LayerSchemaResponse.SchemaColumn.builder()
                .columnKey(column.getColumnKey())
                .inputType(column.getInputType())
                .options(optionDtos)
                .build();
    }

    /**
     * LayerSchemaColumnOption 엔티티를 ColumnOption DTO로 변환
     */
    private LayerSchemaResponse.ColumnOption toColumnOptionDto(LayerSchemaColumnOption option) {
        return LayerSchemaResponse.ColumnOption.builder()
                .value(option.getValue())
                .build();
    }

    private String getEnumNameSafe(Enum<?> e) {
        return (Objects.nonNull(e)) ? e.name() : null;
    }


    /**
     * CreateFieldRequestDto를 LayerSchemaField Entity로 변환
     */
    public LayerSchemaField toLayerSchemaField(LayerSchema schema, SchemaFieldsRequest.CreateFieldRequestDto dto) {
        return LayerSchemaField.builder()
                .layerSchema(schema)
                .name(dto.getName())
                .inputType(dto.getInputType())
                .readOnly(dto.getReadOnly())
                .nullable(dto.getNullable())
                .status(parseStatus(dto.getStatus()))
                .options(new ArrayList<>())
                .build();
    }

    /**
     * CreateFieldOptionRequestDto를 LayerSchemaOption Entity로 변환
     */
    public LayerSchemaOption toLayerSchemaOption(LayerSchemaField field, SchemaFieldsRequest.CreateFieldOptionRequestDto dto) {
        return LayerSchemaOption.builder()
                .field(field)
                .value(dto.getValue())
                .build();
    }

    /**
     * UpdateFieldRequestDto의 데이터로 기존 LayerSchemaField를 업데이트
     */
    public void updateLayerSchemaField(LayerSchemaField field, SchemaFieldsRequest.UpdateFieldRequestDto dto) {
        if (dto.getName() != null) {
            field.setName(dto.getName());
        }
        if (dto.getReadOnly() != null) {
            field.setReadOnly(dto.getReadOnly());
        }
        if (dto.getNullable() != null) {
            field.setNullable(dto.getNullable());
        }
        if (dto.getStatus() != null) {
            field.setStatus(parseStatus(dto.getStatus()));
        }
        if (dto.getInputType() != null) {
            field.setInputType(dto.getInputType());
        }
    }

    /**
     * UpdateFieldOptionDto의 데이터로 기존 LayerSchemaOption을 업데이트
     */
    public void updateLayerSchemaOption(LayerSchemaOption option, SchemaFieldsRequest.UpdateFieldOptionDto dto) {
        if (dto.getValue() != null) {
            option.setValue(dto.getValue());
        }
    }

    /**
     * String을 Status enum으로 변환
     */
    private Status parseStatus(String status) {
        if (status == null) {
            return null;
        }
        try {
            return Status.valueOf(status.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid status value: " + status, e);
        }
    }


}