package com.iitp.iitp_rest.mapper.schema;

import com.iitp.iitp_rest.model.schema.LayerSchema;
import com.iitp.iitp_rest.model.schema.LayerSchemaConfig;
import com.iitp.iitp_rest.model.schema.LayerSchemaConfigOption;
import com.iitp.iitp_rest.model.schema.LayerSchemaField;
import com.iitp.iitp_rest.model.schema.LayerSchemaFieldResponse;
import com.iitp.iitp_rest.model.schema.LayerSchemaOption;
import com.iitp.iitp_rest.model.schema.LayerSchemaOptionResponse;
import com.iitp.iitp_rest.model.schema.LayerSchemaResponse;
import com.iitp.iitp_rest.model.schema.SchemaFieldsRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-03-09T09:09:23+0900",
    comments = "version: 1.6.3, compiler: javac, environment: Java 23.0.2 (Amazon.com Inc.)"
)
@Component
public class SchemaMapperImpl implements SchemaMapper {

    @Override
    public LayerSchemaResponse toLayerSchemaResponse(Long layerId, String layerKey, List<LayerSchema> schemata, List<LayerSchemaConfig> columns, List<String> rootSchemaNames, Map<String, List<String>> structureMap, Map<Long, List<LayerSchemaField>> fieldsBySchemaId, Map<Long, List<LayerSchemaOption>> optionsByFieldId, Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId) {
        if ( layerId == null && layerKey == null && schemata == null && columns == null && rootSchemaNames == null && structureMap == null ) {
            return null;
        }

        LayerSchemaResponse.LayerSchemaResponseBuilder layerSchemaResponse = LayerSchemaResponse.builder();

        if ( layerId != null ) {
            layerSchemaResponse.layerId( layerId );
        }
        if ( layerKey != null ) {
            layerSchemaResponse.layerName( layerKey );
        }
        List<LayerSchemaResponse.SchemaDefinition> list = toSchemaDefinitionList( schemata, fieldsBySchemaId, optionsByFieldId );
        if ( list != null ) {
            layerSchemaResponse.definition( list );
        }
        List<LayerSchemaResponse.SchemaColumn> list1 = toSchemaColumnDtoList( columns, columnOptionsByColumnId );
        if ( list1 != null ) {
            layerSchemaResponse.schemaColumns( list1 );
        }
        layerSchemaResponse.structure( buildStructure(rootSchemaNames, structureMap) );

        return layerSchemaResponse.build();
    }

    @Override
    public LayerSchemaResponse.SchemaDefinition toSchemaDefinition(LayerSchema schema, Map<Long, List<LayerSchemaField>> fieldsBySchemaId, Map<Long, List<LayerSchemaOption>> optionsByFieldId) {
        if ( schema == null ) {
            return null;
        }

        LayerSchemaResponse.SchemaDefinition.SchemaDefinitionBuilder schemaDefinition = LayerSchemaResponse.SchemaDefinition.builder();

        if ( schema.getId() != null ) {
            schemaDefinition.id( schema.getId() );
        }
        if ( schema.getName() != null ) {
            schemaDefinition.name( schema.getName() );
        }
        if ( schema.getStatus() != null ) {
            schemaDefinition.status( schema.getStatus().name() );
        }

        schemaDefinition.fields( mapFields(schema.getId(), fieldsBySchemaId, optionsByFieldId) );

        return schemaDefinition.build();
    }

    @Override
    public List<LayerSchemaResponse.SchemaDefinition> toSchemaDefinitionList(List<LayerSchema> schemata, Map<Long, List<LayerSchemaField>> fieldsBySchemaId, Map<Long, List<LayerSchemaOption>> optionsByFieldId) {
        if ( schemata == null ) {
            return new ArrayList<LayerSchemaResponse.SchemaDefinition>();
        }

        List<LayerSchemaResponse.SchemaDefinition> list = new ArrayList<LayerSchemaResponse.SchemaDefinition>( schemata.size() );
        for ( LayerSchema layerSchema : schemata ) {
            list.add( toSchemaDefinition( layerSchema, fieldsBySchemaId, optionsByFieldId ) );
        }

        return list;
    }

    @Override
    public LayerSchemaFieldResponse toSchemaFieldDto(LayerSchemaField field, Map<Long, List<LayerSchemaOption>> optionsByFieldId) {
        if ( field == null ) {
            return null;
        }

        LayerSchemaFieldResponse.LayerSchemaFieldResponseBuilder layerSchemaFieldResponse = LayerSchemaFieldResponse.builder();

        if ( field.getId() != null ) {
            layerSchemaFieldResponse.id( field.getId() );
        }
        if ( field.getName() != null ) {
            layerSchemaFieldResponse.name( field.getName() );
        }
        if ( field.getInputType() != null ) {
            layerSchemaFieldResponse.inputType( field.getInputType() );
        }
        if ( field.getDefaultValue() != null ) {
            layerSchemaFieldResponse.defaultValue( field.getDefaultValue() );
        }
        layerSchemaFieldResponse.readOnly( field.isReadOnly() );
        layerSchemaFieldResponse.nullable( field.isNullable() );
        if ( field.getStatus() != null ) {
            layerSchemaFieldResponse.status( field.getStatus() );
        }

        layerSchemaFieldResponse.options( mapOptions(field.getId(), optionsByFieldId) );

        return layerSchemaFieldResponse.build();
    }

    @Override
    public List<LayerSchemaOptionResponse> toSchemaOptionDtoList(List<LayerSchemaOption> options) {
        if ( options == null ) {
            return new ArrayList<LayerSchemaOptionResponse>();
        }

        List<LayerSchemaOptionResponse> list = new ArrayList<LayerSchemaOptionResponse>( options.size() );
        for ( LayerSchemaOption layerSchemaOption : options ) {
            list.add( toSchemaOptionDto( layerSchemaOption ) );
        }

        return list;
    }

    @Override
    public LayerSchemaOptionResponse toSchemaOptionDto(LayerSchemaOption option) {
        if ( option == null ) {
            return null;
        }

        LayerSchemaOptionResponse.LayerSchemaOptionResponseBuilder layerSchemaOptionResponse = LayerSchemaOptionResponse.builder();

        if ( option.getId() != null ) {
            layerSchemaOptionResponse.id( option.getId() );
        }
        if ( option.getValue() != null ) {
            layerSchemaOptionResponse.value( option.getValue() );
        }

        return layerSchemaOptionResponse.build();
    }

    @Override
    public LayerSchemaResponse.SchemaColumn toSchemaColumnDto(LayerSchemaConfig column, Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId) {
        if ( column == null ) {
            return null;
        }

        LayerSchemaResponse.SchemaColumn.SchemaColumnBuilder schemaColumn = LayerSchemaResponse.SchemaColumn.builder();

        if ( column.getConfigKey() != null ) {
            schemaColumn.configKey( column.getConfigKey() );
        }
        if ( column.getInputType() != null ) {
            schemaColumn.inputType( column.getInputType() );
        }

        schemaColumn.options( toColumnOptionDtoList(columnOptionsByColumnId.getOrDefault(column.getId(), java.util.Collections.emptyList())) );

        return schemaColumn.build();
    }

    @Override
    public List<LayerSchemaResponse.SchemaColumn> toSchemaColumnDtoList(List<LayerSchemaConfig> columns, Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId) {
        if ( columns == null ) {
            return new ArrayList<LayerSchemaResponse.SchemaColumn>();
        }

        List<LayerSchemaResponse.SchemaColumn> list = new ArrayList<LayerSchemaResponse.SchemaColumn>( columns.size() );
        for ( LayerSchemaConfig layerSchemaConfig : columns ) {
            list.add( toSchemaColumnDto( layerSchemaConfig, columnOptionsByColumnId ) );
        }

        return list;
    }

    @Override
    public List<LayerSchemaResponse.ColumnOption> toColumnOptionDtoList(List<LayerSchemaConfigOption> options) {
        if ( options == null ) {
            return new ArrayList<LayerSchemaResponse.ColumnOption>();
        }

        List<LayerSchemaResponse.ColumnOption> list = new ArrayList<LayerSchemaResponse.ColumnOption>( options.size() );
        for ( LayerSchemaConfigOption layerSchemaConfigOption : options ) {
            list.add( toColumnOptionDto( layerSchemaConfigOption ) );
        }

        return list;
    }

    @Override
    public LayerSchemaResponse.ColumnOption toColumnOptionDto(LayerSchemaConfigOption option) {
        if ( option == null ) {
            return null;
        }

        LayerSchemaResponse.ColumnOption.ColumnOptionBuilder columnOption = LayerSchemaResponse.ColumnOption.builder();

        if ( option.getValue() != null ) {
            columnOption.value( option.getValue() );
        }

        return columnOption.build();
    }

    @Override
    public LayerSchemaField toLayerSchemaField(SchemaFieldsRequest.CreateFieldRequest dto) {
        if ( dto == null ) {
            return null;
        }

        LayerSchemaField.LayerSchemaFieldBuilder layerSchemaField = LayerSchemaField.builder();

        if ( dto.getName() != null ) {
            layerSchemaField.name( dto.getName() );
        }
        if ( dto.getInputType() != null ) {
            layerSchemaField.inputType( dto.getInputType() );
        }
        if ( dto.getDefaultValue() != null ) {
            layerSchemaField.defaultValue( dto.getDefaultValue() );
        }
        if ( dto.getReadOnly() != null ) {
            layerSchemaField.readOnly( dto.getReadOnly() );
        }
        if ( dto.getNullable() != null ) {
            layerSchemaField.nullable( dto.getNullable() );
        }
        if ( dto.getStatus() != null ) {
            layerSchemaField.status( dto.getStatus() );
        }

        return layerSchemaField.build();
    }

    @Override
    public LayerSchemaOption toLayerSchemaOption(SchemaFieldsRequest.CreateFieldOptionRequest dto) {
        if ( dto == null ) {
            return null;
        }

        LayerSchemaOption.LayerSchemaOptionBuilder layerSchemaOption = LayerSchemaOption.builder();

        if ( dto.getValue() != null ) {
            layerSchemaOption.value( dto.getValue() );
        }

        return layerSchemaOption.build();
    }

    @Override
    public void updateLayerSchemaField(LayerSchemaField target, SchemaFieldsRequest.UpdateFieldRequest dto) {
        if ( dto == null ) {
            return;
        }

        if ( dto.getName() != null ) {
            target.setName( dto.getName() );
        }
        if ( dto.getInputType() != null ) {
            target.setInputType( dto.getInputType() );
        }
        if ( dto.getDefaultValue() != null ) {
            target.setDefaultValue( dto.getDefaultValue() );
        }
        if ( dto.getReadOnly() != null ) {
            target.setReadOnly( dto.getReadOnly() );
        }
        if ( dto.getNullable() != null ) {
            target.setNullable( dto.getNullable() );
        }
        if ( dto.getStatus() != null ) {
            target.setStatus( dto.getStatus() );
        }
        if ( target.getOptions() != null ) {
            List<LayerSchemaOption> list = updateFieldOptionListToLayerSchemaOptionList( dto.getOptions() );
            if ( list != null ) {
                target.getOptions().clear();
                target.getOptions().addAll( list );
            }
        }
        else {
            List<LayerSchemaOption> list = updateFieldOptionListToLayerSchemaOptionList( dto.getOptions() );
            if ( list != null ) {
                target.setOptions( list );
            }
        }
    }

    @Override
    public void updateLayerSchemaOption(LayerSchemaOption target, SchemaFieldsRequest.UpdateFieldOption dto) {
        if ( dto == null ) {
            return;
        }

        if ( dto.getValue() != null ) {
            target.setValue( dto.getValue() );
        }
    }

    protected LayerSchemaOption updateFieldOptionToLayerSchemaOption(SchemaFieldsRequest.UpdateFieldOption updateFieldOption) {
        if ( updateFieldOption == null ) {
            return null;
        }

        LayerSchemaOption.LayerSchemaOptionBuilder layerSchemaOption = LayerSchemaOption.builder();

        if ( updateFieldOption.getId() != null ) {
            layerSchemaOption.id( updateFieldOption.getId() );
        }
        if ( updateFieldOption.getValue() != null ) {
            layerSchemaOption.value( updateFieldOption.getValue() );
        }

        return layerSchemaOption.build();
    }

    protected List<LayerSchemaOption> updateFieldOptionListToLayerSchemaOptionList(List<SchemaFieldsRequest.UpdateFieldOption> list) {
        if ( list == null ) {
            return new ArrayList<LayerSchemaOption>();
        }

        List<LayerSchemaOption> list1 = new ArrayList<LayerSchemaOption>( list.size() );
        for ( SchemaFieldsRequest.UpdateFieldOption updateFieldOption : list ) {
            list1.add( updateFieldOptionToLayerSchemaOption( updateFieldOption ) );
        }

        return list1;
    }
}
