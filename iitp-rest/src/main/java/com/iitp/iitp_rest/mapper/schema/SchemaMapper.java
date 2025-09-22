package com.iitp.iitp_rest.mapper.schema;

import com.iitp.iitp_rest.config.GlobalMapperConfig;
import com.iitp.iitp_rest.model.schema.*;
import org.mapstruct.*;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Mapper(config = GlobalMapperConfig.class)
public interface SchemaMapper {

    @Mappings({
            @Mapping(target = "layerId", source = "layerId"),
            @Mapping(target = "layerName", source = "layerKey"),
            @Mapping(target = "definition", source = "schemata"),
            @Mapping(target = "schemaColumns", source = "columns"),
            @Mapping(target = "structure", expression = "java( buildStructure(rootSchemaNames, structureMap) )")
    })
    LayerSchemaResponse toLayerSchemaResponse(
            Long layerId,
            String layerKey,
            List<LayerSchema> schemata,
            List<LayerSchemaConfig> columns,
            List<String> rootSchemaNames,
            Map<String, List<String>> structureMap,
            @Context Map<Long, List<LayerSchemaField>> fieldsBySchemaId,
            @Context Map<Long, List<LayerSchemaOption>> optionsByFieldId,
            @Context Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId
    );

    @Mapping(target = "fields", expression = "java( mapFields(schema.getId(), fieldsBySchemaId, optionsByFieldId) )")
    LayerSchemaResponse.SchemaDefinition toSchemaDefinition(
            LayerSchema schema,
            @Context Map<Long, List<LayerSchemaField>> fieldsBySchemaId,
            @Context Map<Long, List<LayerSchemaOption>> optionsByFieldId
    );

    List<LayerSchemaResponse.SchemaDefinition> toSchemaDefinitionList(
            List<LayerSchema> schemata,
            @Context Map<Long, List<LayerSchemaField>> fieldsBySchemaId,
            @Context Map<Long, List<LayerSchemaOption>> optionsByFieldId
    );

    default List<LayerSchemaResponse.SchemaStructure> buildStructure(
            List<String> rootSchemaNames,
            Map<String, List<String>> structureMap
    ) {
        if (rootSchemaNames == null || rootSchemaNames.isEmpty()) {
            return Collections.emptyList();
        }
        List<LayerSchemaResponse.SchemaStructure> structure = new ArrayList<>();
        for (String rootName : rootSchemaNames) {
            structure.add(buildDefinition(rootName, structureMap));
        }
        return structure;
    }

    default LayerSchemaResponse.SchemaStructure buildDefinition(
            String name,
            Map<String, List<String>> structureMap
    ) {
        List<String> childNames = structureMap.getOrDefault(name, Collections.emptyList());
        List<LayerSchemaResponse.SchemaStructure> children = new ArrayList<>();

        if (!childNames.isEmpty()) {
            for (String childName : childNames) {
                children.add(buildDefinition(childName, structureMap));
            }
        }

        return LayerSchemaResponse.SchemaStructure.builder()
                .name(name)
                .children(children)
                .build();
    }

    default List<LayerSchemaFieldResponse> mapFields(
            Long schemaId,
            @Context Map<Long, List<LayerSchemaField>> fieldsBySchemaId,
            @Context Map<Long, List<LayerSchemaOption>> optionsByFieldId
    ) {
        List<LayerSchemaField> fields = fieldsBySchemaId.getOrDefault(schemaId, Collections.emptyList());
        if (fields.isEmpty()) return List.of();
        List<LayerSchemaFieldResponse> out = new ArrayList<>(fields.size());
        for (LayerSchemaField f : fields) {
            out.add(toSchemaFieldDto(f, optionsByFieldId));
        }
        return out;
    }

    @Mapping(target = "options", expression = "java( mapOptions(field.getId(), optionsByFieldId) )")
    LayerSchemaFieldResponse toSchemaFieldDto(
            LayerSchemaField field,
            @Context Map<Long, List<LayerSchemaOption>> optionsByFieldId
    );

    default List<LayerSchemaOptionResponse> mapOptions(
            Long fieldId,
            @Context Map<Long, List<LayerSchemaOption>> optionsByFieldId
    ) {
        List<LayerSchemaOption> opts = optionsByFieldId.getOrDefault(fieldId, Collections.emptyList());
        return toSchemaOptionDtoList(opts);
    }

    List<LayerSchemaOptionResponse> toSchemaOptionDtoList(List<LayerSchemaOption> options);

    LayerSchemaOptionResponse toSchemaOptionDto(LayerSchemaOption option);

    @Mapping(target = "options", expression =
            "java( toColumnOptionDtoList(columnOptionsByColumnId.getOrDefault(column.getId(), java.util.Collections.emptyList())) )")
    LayerSchemaResponse.SchemaColumn toSchemaColumnDto(
            LayerSchemaConfig column,
            @Context Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId
    );

    List<LayerSchemaResponse.SchemaColumn> toSchemaColumnDtoList(
            List<LayerSchemaConfig> columns,
            @Context Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId
    );

    List<LayerSchemaResponse.ColumnOption> toColumnOptionDtoList(List<LayerSchemaConfigOption> options);

    LayerSchemaResponse.ColumnOption toColumnOptionDto(LayerSchemaConfigOption option);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "layerSchema", ignore = true)
    @Mapping(target = "options", ignore = true)
    LayerSchemaField toLayerSchemaField(SchemaFieldsRequest.CreateFieldRequest dto);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "field", ignore = true)
    LayerSchemaOption toLayerSchemaOption(SchemaFieldsRequest.CreateFieldOptionRequest dto);

    default LayerSchemaField toLayerSchemaField(LayerSchema schema, SchemaFieldsRequest.CreateFieldRequest dto) {
        LayerSchemaField f = toLayerSchemaField(dto);
        f.setLayerSchema(schema);
        if (f.getOptions() == null) f.setOptions(new ArrayList<>());
        return f;
    }

    default LayerSchemaOption toLayerSchemaOption(LayerSchemaField field, SchemaFieldsRequest.CreateFieldOptionRequest dto) {
        LayerSchemaOption o = toLayerSchemaOption(dto);
        o.setField(field);
        return o;
    }

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    void updateLayerSchemaField(@MappingTarget LayerSchemaField target, SchemaFieldsRequest.UpdateFieldRequest dto);

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    void updateLayerSchemaOption(@MappingTarget LayerSchemaOption target, SchemaFieldsRequest.UpdateFieldOption dto);
}
