package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.schema.LayerSchemaField;
import com.iitp.iitp_rest.model.schema.LayerSchemaNode;
import com.iitp.iitp_rest.model.schema.LayerSchemaOption;
import com.iitp.iitp_rest.model.schema.LayerSchemaResponse;
import com.iitp.iitp_rest.repository.LayerRepository;
import com.iitp.iitp_rest.repository.LayerSchemaFieldRepository;
import com.iitp.iitp_rest.repository.LayerSchemaNodeRepository;
import com.iitp.iitp_rest.repository.LayerSchemaOptionRepository;
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
public class LayerSchemaService {

    private final LayerRepository layerRepository;
    private final LayerSchemaNodeRepository nodeRepository;
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
        List<Long> layerIds = nodeRepository.findDistinctLayerIds();
        if (CollectionUtils.isEmpty(layerIds)) {
            return Collections.emptyList();
        }
        return createSchemata(layerIds);
    }

    private List<LayerSchemaResponse> createSchemata(List<Long> layerIds) {

        Map<Long, String> layerKeyById = layerRepository.findAllById(layerIds).stream()
                .collect(Collectors.toMap(Layer::getId, Layer::getKey));

        List<LayerSchemaNode> allNodes = nodeRepository.findAllByLayerIdIn(layerIds);
        List<LayerSchemaField> allFields = fieldRepository.findAllByLayerSchemaNode_Layer_IdIn(layerIds);
        List<LayerSchemaOption> allOptions = optionRepository.findAllByField_LayerSchemaNode_Layer_IdIn(layerIds);

        Map<Long, List<LayerSchemaNode>> nodesByLayerId = allNodes.stream()
                .collect(Collectors.groupingBy(node -> node.getLayer().getId()));
        Map<Long, List<LayerSchemaField>> fieldsByLayerId = allFields.stream()
                .collect(Collectors.groupingBy(field -> field.getLayerSchemaNode().getLayer().getId()));
        Map<Long, List<LayerSchemaOption>> optionsByLayerId = allOptions.stream()
                .collect(Collectors.groupingBy(option -> option.getField().getLayerSchemaNode().getLayer().getId()));

        return layerIds.stream()
                .map(layerId -> {
                    List<LayerSchemaNode> nodes = nodesByLayerId.getOrDefault(layerId, Collections.emptyList());
                    List<LayerSchemaField> fields = fieldsByLayerId.getOrDefault(layerId, Collections.emptyList());
                    List<LayerSchemaOption> options = optionsByLayerId.getOrDefault(layerId, Collections.emptyList());

                    return new SchemaBuilder(layerId, layerKeyById.get(layerId), nodes, fields, options).build();
                })
                .toList();
    }

    private static class SchemaBuilder {
        private final Long layerId;
        private final String layerKey;
        private final List<LayerSchemaNode> nodes;

        private final Map<Long, List<LayerSchemaNode>> childrenByParentId;
        private final Map<Long, List<LayerSchemaField>> fieldsByNodeId;
        private final Map<Long, List<LayerSchemaOption>> optionsByFieldId;

        public SchemaBuilder(Long layerId, String layerKey, List<LayerSchemaNode> nodes, List<LayerSchemaField> fields, List<LayerSchemaOption> options) {
            this.layerId = layerId;
            this.layerKey = layerKey;
            this.nodes = nodes;

            this.childrenByParentId = nodes.stream()
                    .filter(node -> node.getParent() != null)
                    .collect(Collectors.groupingBy(node -> node.getParent().getId()));

            this.fieldsByNodeId = fields.stream()
                    .collect(Collectors.groupingBy(field -> field.getLayerSchemaNode().getId()));

            this.optionsByFieldId = options.stream()
                    .collect(Collectors.groupingBy(option -> option.getField().getId()));
        }

        public LayerSchemaResponse build() {
            List<LayerSchemaResponse.SchemaNode> rootNodes = this.nodes.stream()
                    .filter(node -> node.getParent() == null)
                    .map(this::toSchemaNode)
                    .toList();

            return LayerSchemaResponse.builder()
                    .layerId(layerId)
                    .layerName(layerKey)
                    .roots(rootNodes)
                    .build();
        }

        private LayerSchemaResponse.SchemaNode toSchemaNode(LayerSchemaNode node) {
            List<LayerSchemaResponse.SchemaField> fieldDtos = fieldsByNodeId
                    .getOrDefault(node.getId(), Collections.emptyList())
                    .stream()
                    .map(this::toSchemaField)
                    .toList();

            List<LayerSchemaResponse.SchemaNode> childrenDtos = childrenByParentId
                    .getOrDefault(node.getId(), Collections.emptyList())
                    .stream()
                    .map(this::toSchemaNode)
                    .toList();

            return LayerSchemaResponse.SchemaNode.builder()
                    .id(node.getId())
                    .name(node.getName())
                    .depth(node.getDepth())
                    .sortOrder(node.getSortOrder())
                    .status(getEnumNameSafe(node.getStatus()))
                    .fields(fieldDtos)
                    .children(childrenDtos)
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
                    .dataType(field.getDataType())
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