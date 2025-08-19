package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.schema.LayerSchema;
import com.iitp.iitp_rest.model.schema.LayerSchemaField;
import com.iitp.iitp_rest.model.schema.LayerSchemaOption;
import com.iitp.iitp_rest.model.schema.LayerSchemaResponse;
import com.iitp.iitp_rest.repository.LayerRepository;
import com.iitp.iitp_rest.repository.LayerSchemaFieldRepository;
import com.iitp.iitp_rest.repository.LayerSchemaOptionRepository;
import com.iitp.iitp_rest.repository.LayerSchemaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SchemaService {
    private final LayerRepository layerRepository;
    private final LayerSchemaRepository schemaRepository;
    private final LayerSchemaFieldRepository fieldRepository;
    private final LayerSchemaOptionRepository optionRepository;

    public LayerSchemaResponse getSchemaByLayerKey(String layerKey) {

        Layer layer = layerRepository.findByKey(layerKey)
                .orElseThrow(() -> new IllegalArgumentException("Layer not found for key: " + layerKey));

        Long layerId = layer.getId();

        List<LayerSchemaResponse> schemata = createSchemata(Collections.singletonList(layerId));
        if (CollectionUtils.isEmpty(schemata)) {
            throw new IllegalArgumentException("Schema not found for layerId: " + layerId);
        }
        return schemata.get(0);
    }

    public List<LayerSchemaResponse> getSchemata() {
        List<Long> layerIds = schemaRepository.findDistinctLayerIds();
        if (CollectionUtils.isEmpty(layerIds)) {
            return Collections.emptyList();
        }
        return createSchemata(layerIds);
    }

    private List<LayerSchemaResponse> createSchemata(List<Long> layerIds) {

        Map<Long, String> layerKeyById = layerRepository.findAllById(layerIds).stream()
                .collect(Collectors.toMap(Layer::getId, Layer::getKey));

        List<LayerSchema> allSchemata = schemaRepository.findAllByLayerIdIn(layerIds);
        List<LayerSchemaField> allFields = fieldRepository.findAllByLayerSchema_Layer_IdIn(layerIds);
        List<LayerSchemaOption> allOptions = optionRepository.findAllByField_LayerSchema_Layer_IdIn(layerIds);

        Map<Long, List<LayerSchema>> schemataByLayerId = allSchemata.stream()
                .collect(Collectors.groupingBy(node -> node.getLayer().getId()));
        Map<Long, List<LayerSchemaField>> fieldsByLayerId = allFields.stream()
                .collect(Collectors.groupingBy(field -> field.getLayerSchema().getLayer().getId()));
        Map<Long, List<LayerSchemaOption>> optionsByLayerId = allOptions.stream()
                .collect(Collectors.groupingBy(option -> option.getField().getLayerSchema().getLayer().getId()));

        return layerIds.stream()
                .map(layerId -> {
                    List<LayerSchema> nodes = schemataByLayerId.getOrDefault(layerId, Collections.emptyList());
                    List<LayerSchemaField> fields = fieldsByLayerId.getOrDefault(layerId, Collections.emptyList());
                    List<LayerSchemaOption> options = optionsByLayerId.getOrDefault(layerId, Collections.emptyList());

                    return new SchemaBuilder(layerId, layerKeyById.get(layerId), nodes, fields, options).build();
                })
                .toList();
    }

    private static class SchemaBuilder {
        private final Long layerId;
        private final String layerKey;
        private final List<LayerSchema> schemata;

        private final Map<Long, List<LayerSchemaField>> fieldsBySchemaId;
        private final Map<Long, List<LayerSchemaOption>> optionsByFieldId;

        public SchemaBuilder(Long layerId, String layerKey, List<LayerSchema> schemata, List<LayerSchemaField> fields, List<LayerSchemaOption> options) {
            this.layerId = layerId;
            this.layerKey = layerKey;
            this.schemata = schemata;

            this.fieldsBySchemaId = fields.stream()
                    .collect(Collectors.groupingBy(field -> field.getLayerSchema().getId()));

            this.optionsByFieldId = options.stream()
                    .collect(Collectors.groupingBy(option -> option.getField().getId()));
        }

        public LayerSchemaResponse build() {
            List<LayerSchemaResponse.Schema> schemata = this.schemata.stream()
                    .map(this::toSchema)
                    .toList();

            return LayerSchemaResponse.builder()
                    .layerId(layerId)
                    .layerName(layerKey)
                    .schemata(schemata)
                    .build();
        }

        private LayerSchemaResponse.Schema toSchema(LayerSchema schema) {
            List<LayerSchemaResponse.SchemaField> fieldDtos = fieldsBySchemaId
                    .getOrDefault(schema.getId(), Collections.emptyList())
                    .stream()
                    .map(this::toSchemaField)
                    .toList();

            return LayerSchemaResponse.Schema.builder()
                    .id(schema.getId())
                    .name(schema.getName())
                    .sortOrder(schema.getSortOrder())
                    .status(getEnumNameSafe(schema.getStatus()))
                    .fields(fieldDtos)
                    .build();
        }

        private LayerSchemaResponse.SchemaField toSchemaField(LayerSchemaField field) {
            List<LayerSchemaResponse.SchemaOption> optionDtos = optionsByFieldId
                    .getOrDefault(field.getId(), Collections.emptyList())
                    .stream()
                    .map(option -> LayerSchemaResponse.SchemaOption.builder()
                            .id(option.getId())
                            .value(option.getValue())
                            .build())
                    .toList();

            return LayerSchemaResponse.SchemaField.builder()
                    .id(field.getId())
                    .name(field.getName())
                    .inputType(field.getInputType())
                    .readOnly(field.isReadOnly())
                    .status(getEnumNameSafe(field.getStatus()))
                    .options(optionDtos)
                    .build();
        }

        private <T extends Enum<T>> String getEnumNameSafe(T enumConstant) {
            return Objects.nonNull(enumConstant) ? enumConstant.name() : null;
        }
    }
}
