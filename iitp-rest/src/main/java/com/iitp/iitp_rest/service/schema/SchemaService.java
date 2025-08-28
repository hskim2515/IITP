package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.mapper.schema.SchemaMapper;
import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.schema.*;
import com.iitp.iitp_rest.model.schema.LayerSchemaConfig;
import com.iitp.iitp_rest.model.schema.LayerSchemaConfigOption;
import com.iitp.iitp_rest.repository.LayerRepository;
import com.iitp.iitp_rest.repository.LayerSchemaColumnRepository;
import com.iitp.iitp_rest.repository.LayerSchemaColumnOptionRepository;
import com.iitp.iitp_rest.repository.LayerSchemaFieldRepository;
import com.iitp.iitp_rest.repository.LayerSchemaOptionRepository;
import com.iitp.iitp_rest.repository.LayerSchemaRepository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SchemaService {
    private final LayerRepository layerRepository;
    private final LayerSchemaRepository layerSchemaRepository;
    private final LayerSchemaFieldRepository fieldRepository;
    private final LayerSchemaOptionRepository optionRepository;

    private final LayerSchemaService schemaService;
    private final LayerSchemaFieldService fieldService;
    private final LayerSchemaOptionService optionService;

    private final SchemaMapper schemaMapper;

    private final LayerSchemaColumnRepository columnRepository;
    private final LayerSchemaColumnOptionRepository columnOptionRepository;

    public LayerSchemaResponse getSchemaByLayerKey(String layerKey) {
        Layer layer = layerRepository.findByKey(layerKey)
                .orElseThrow(() -> new IllegalArgumentException("Layer not found for key: " + layerKey));

        return createSchemaResponseForLayers(Collections.singletonList(layer.getId())).get(0);
    }

    public List<LayerSchemaResponse> getSchemata() {
        List<Long> layerIds = schemaService.findDistinctLayerIds();
        if (CollectionUtils.isEmpty(layerIds)) {
            return Collections.emptyList();
        }
        return createSchemaResponseForLayers(layerIds);
    }
    private List<LayerSchemaResponse> createSchemaResponseForLayers(List<Long> layerIds) {

        List<LayerSchemaConfig> allColumns = columnRepository.findAll(Sort.by(Sort.Direction.ASC, "sortOrder"));
        List<LayerSchemaConfigOption> allColumnOptions = columnOptionRepository.findAll();

        Map<Long, String> layerKeyById = layerRepository.findAllById(layerIds).stream()
                .collect(Collectors.toMap(Layer::getId, Layer::getKey));

        List<LayerSchema> allSchemata = schemaService.findAllByLayerIdIn(layerIds);
        List<LayerSchemaField> allFields = fieldService.findAllByLayerSchema_Layer_IdIn(layerIds);
        List<LayerSchemaOption> allOptions = optionService.findAllByField_LayerSchema_Layer_IdIn(layerIds);

        Map<Long, List<LayerSchema>> schemataByLayerId = allSchemata.stream()
                .collect(Collectors.groupingBy(node -> node.getLayer().getId()));
        Map<Long, List<LayerSchemaField>> fieldsByLayerId = allFields.stream()
                .collect(Collectors.groupingBy(field -> field.getLayerSchema().getLayer().getId()));
        Map<Long, List<LayerSchemaOption>> optionsByLayerId = allOptions.stream()
                .collect(Collectors.groupingBy(option -> option.getField().getLayerSchema().getLayer().getId()));

        return layerIds.stream()
                .map(layerId -> {
                    List<LayerSchema> schemataForLayer = schemataByLayerId.getOrDefault(layerId, Collections.emptyList());
                    List<LayerSchemaField> fieldsForLayer = fieldsByLayerId.getOrDefault(layerId, Collections.emptyList());
                    List<LayerSchemaOption> optionsForLayer = optionsByLayerId.getOrDefault(layerId, Collections.emptyList());

                    return schemaMapper.toLayerSchemaResponse(
                            layerId,
                            layerKeyById.get(layerId),
                            schemataForLayer,
                            fieldsForLayer,
                            optionsForLayer,
                            allColumns,
                            allColumnOptions
                    );
                })
                .toList();
    }

    @Transactional
    public void updateSchemata(String layerKey, List<SchemaFieldsRequest> dtos) {
        for (SchemaFieldsRequest dto : dtos) {
            updateSchemaFields(dto);
        }
    }

    private void updateSchemaFields(SchemaFieldsRequest request) {
        // 1. Schema 조회 및 검증
        LayerSchema schema = layerSchemaRepository.findById(request.getId())
                .orElseThrow(() -> new IllegalArgumentException("LayerSchema not found, id=" + request.getId()));

        // 2. 필드 삭제
        deleteFields(request.getFieldIdsToDelete());

        // 3. 새 필드 생성
        createNewFields(schema, request.getFieldsToCreate());

        // 4. 기존 필드 업데이트
        updateExistingFields(request.getFieldsToUpdate());
    }

    private void deleteFields(List<Long> fieldIdsToDelete) {
        if (!CollectionUtils.isEmpty(fieldIdsToDelete)) {
            fieldRepository.deleteAllByIdInBatch(fieldIdsToDelete);
        }
    }

    private void createNewFields(LayerSchema schema, List<SchemaFieldsRequest.CreateFieldRequestDto> fieldsToCreate) {
        if (CollectionUtils.isEmpty(fieldsToCreate)) {
            return;
        }

        List<LayerSchemaField> newFields = fieldsToCreate.stream()
                .map(dto -> createField(schema, dto))
                .collect(Collectors.toList());

        fieldRepository.saveAll(newFields);
    }

    private LayerSchemaField createField(LayerSchema schema, SchemaFieldsRequest.CreateFieldRequestDto dto) {
        // Mapper를 사용하여 Entity 생성
        LayerSchemaField field = schemaMapper.toLayerSchemaField(schema, dto);

        // select 타입인 경우 옵션 생성
        if ("select".equalsIgnoreCase(dto.getInputType()) && !CollectionUtils.isEmpty(dto.getOptions())) {
            // options 컬렉션 초기화
            if (field.getOptions() == null) {
                field.setOptions(new ArrayList<>());
            }

            List<LayerSchemaOption> options = dto.getOptions().stream()
                    .map(optionDto -> schemaMapper.toLayerSchemaOption(field, optionDto))
                    .collect(Collectors.toList());
            field.getOptions().addAll(options);
        }

        return field;
    }

    private void updateExistingFields(List<SchemaFieldsRequest.UpdateFieldRequestDto> fieldsToUpdate) {
        if (CollectionUtils.isEmpty(fieldsToUpdate)) {
            return;
        }

        for (SchemaFieldsRequest.UpdateFieldRequestDto dto : fieldsToUpdate) {
            updateField(dto);
        }
    }

    private void updateField(SchemaFieldsRequest.UpdateFieldRequestDto dto) {
        if (dto == null || dto.getId() == null) {
            throw new IllegalArgumentException("UpdateFieldRequestDto.id is required");
        }

        LayerSchemaField field = fieldRepository.findById(dto.getId())
                .orElseThrow(() -> new IllegalArgumentException("LayerSchemaField not found, id=" + dto.getId()));

        // 필드 기본 정보 업데이트
        updateFieldBasicInfo(field, dto);

        // 옵션 업데이트 (select 타입인 경우)
        updateFieldOptions(field, dto);

        // JPA Cascade 덕분에 field 저장 시 변경된 options도 자동으로 저장됨
        fieldRepository.save(field);
    }

    private void updateFieldBasicInfo(LayerSchemaField field, SchemaFieldsRequest.UpdateFieldRequestDto dto) {
        // Mapper를 사용하여 기본 정보 업데이트
        schemaMapper.updateLayerSchemaField(field, dto);

        // 입력 타입이 변경되어 select가 아니게 된 경우 기존 옵션들 삭제
        if (dto.getInputType() != null && !"select".equalsIgnoreCase(dto.getInputType())) {
            deleteFieldOptionsIfExists(field);
        }
    }

    private void deleteFieldOptionsIfExists(LayerSchemaField field) {
        if (field.getOptions() != null && !field.getOptions().isEmpty()) {
            List<Long> optionIds = field.getOptions().stream()
                    .map(LayerSchemaOption::getId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());

            if (!optionIds.isEmpty()) {
                optionRepository.deleteAllByIdInBatch(optionIds);
            }
            field.getOptions().clear();
        }
    }

    private void updateFieldOptions(LayerSchemaField field, SchemaFieldsRequest.UpdateFieldRequestDto dto) {
        if (!"select".equalsIgnoreCase(field.getInputType())) {
            return; // 비-select 필드는 옵션 없음
        }

        // 새 옵션 생성
        createNewOptions(field, dto.getOptionsToCreate());

        // 기존 옵션 업데이트
        updateExistingOptions(field, dto.getOptions());

        // 옵션 삭제
        deleteOptions(field, dto.getOptionIdsToDelete());
    }

    private void createNewOptions(LayerSchemaField field, List<SchemaFieldsRequest.CreateFieldOptionRequestDto> optionsToCreate) {
        if (CollectionUtils.isEmpty(optionsToCreate)) {
            return;
        }

        for (SchemaFieldsRequest.CreateFieldOptionRequestDto dto : optionsToCreate) {
            LayerSchemaOption option = schemaMapper.toLayerSchemaOption(field, dto);
            field.getOptions().add(option);  // 기존 컬렉션에 추가만
        }
    }

    private void updateExistingOptions(LayerSchemaField field, List<SchemaFieldsRequest.UpdateFieldOptionDto> optionsToUpdate) {
        if (CollectionUtils.isEmpty(optionsToUpdate)) {
            return;
        }

        Map<Long, LayerSchemaOption> optionIndex = Optional.ofNullable(field.getOptions())
                .orElseGet(Collections::emptyList)
                .stream()
                .filter(o -> o.getId() != null)
                .collect(Collectors.toMap(LayerSchemaOption::getId, Function.identity()));

        for (SchemaFieldsRequest.UpdateFieldOptionDto dto : optionsToUpdate) {
            LayerSchemaOption option = optionIndex.get(dto.getId());
            if (option == null) {
                throw new IllegalArgumentException("Option not found: id=" + dto.getId() + " for field=" + field.getId());
            }
            schemaMapper.updateLayerSchemaOption(option, dto);
        }
    }

    private void deleteOptions(LayerSchemaField field, List<Long> optionIdsToDelete) {
        if (CollectionUtils.isEmpty(optionIdsToDelete)) {
            return;
        }

        Set<Long> idsToDelete = new HashSet<>(optionIdsToDelete);

        // OrphanRemoval이 없으므로 명시적으로 DB에서 먼저 삭제
        optionRepository.deleteAllByIdInBatch(idsToDelete);

        // 그 다음 컬렉션에서도 제거 (메모리 동기화)
        field.getOptions().removeIf(option ->
                option.getId() != null && idsToDelete.contains(option.getId()));
    }

}