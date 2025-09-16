package com.iitp.iitp_rest.service.schema;

import com.iitp.iitp_rest.mapper.schema.SchemaMapper;
import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.schema.*;
import com.iitp.iitp_rest.repository.LayerRepository;
import com.iitp.iitp_rest.repository.LayerSchemaColumnOptionRepository;
import com.iitp.iitp_rest.repository.LayerSchemaColumnRepository;
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

        // 공용 컬럼/컬럼옵션(정렬 포함)
        List<LayerSchemaConfig> allColumns = columnRepository.findAll(Sort.by(Sort.Direction.ASC, "sortOrder"));
        List<LayerSchemaConfigOption> allColumnOptions = columnOptionRepository.findAll();

        // 레이어 키 조회
        Map<Long, String> layerKeyById = layerRepository.findAllById(layerIds).stream()
                .collect(Collectors.toMap(Layer::getId, Layer::getKey));

        // 스키마/필드/옵션 전체 조회
        List<LayerSchema> allSchemata = schemaService.findAllByLayerIdIn(layerIds);
        List<LayerSchemaField> allFields = fieldService.findAllByLayerSchema_Layer_IdIn(layerIds);
        List<LayerSchemaOption> allOptions = optionService.findAllByField_LayerSchema_Layer_IdIn(layerIds);

        // === Service의 책임: 컨텍스트 맵 생성 (id 기반) ===
        Map<Long, List<LayerSchemaField>> fieldsBySchemaId = allFields.stream()
                .collect(Collectors.groupingBy(f -> f.getLayerSchema().getId()));

        Map<Long, List<LayerSchemaOption>> optionsByFieldId = allOptions.stream()
                .collect(Collectors.groupingBy(o -> o.getField().getId()));

        Map<Long, List<LayerSchemaConfigOption>> columnOptionsByColumnId = allColumnOptions.stream()
                .collect(Collectors.groupingBy(co -> co.getDefinition().getId()));

        // 레이어별 스키마 묶음 (schemata만 레이어 id로 필터링)
        Map<Long, List<LayerSchema>> schemataByLayerId = allSchemata.stream()
                .collect(Collectors.groupingBy(s -> s.getLayer().getId()));

        // === Mapper 호출: 순수 매핑 + @Context 전달 ===
        return layerIds.stream()
                .map(layerId -> {
                    List<LayerSchema> schemataForLayer =
                            schemataByLayerId.getOrDefault(layerId, Collections.emptyList());

                    return schemaMapper.toLayerSchemaResponse(
                            layerId,
                            layerKeyById.get(layerId),
                            schemataForLayer,
                            allColumns,
                            fieldsBySchemaId,
                            optionsByFieldId,
                            columnOptionsByColumnId
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

    private void createNewFields(LayerSchema schema, List<SchemaFieldsRequest.CreateFieldRequest> fieldsToCreate) {
        if (CollectionUtils.isEmpty(fieldsToCreate)) {
            return;
        }

        List<LayerSchemaField> newFields = fieldsToCreate.stream()
                .map(dto -> createField(schema, dto))
                .collect(Collectors.toList());

        fieldRepository.saveAll(newFields);
    }

    private LayerSchemaField createField(LayerSchema schema, SchemaFieldsRequest.CreateFieldRequest dto) {
        // Mapper를 사용하여 Entity 생성
        LayerSchemaField field = schemaMapper.toLayerSchemaField(schema, dto);

        // select 타입인 경우 옵션 생성
        if ("select".equalsIgnoreCase(dto.getInputType()) && !CollectionUtils.isEmpty(dto.getOptions())) {
            if (field.getOptions() == null) {
                field.setOptions(new ArrayList<>());
            }
            List<LayerSchemaOption> options = dto.getOptions().stream()
                    .map(optionDto -> schemaMapper.toLayerSchemaOption(field, optionDto))
                    .toList();
            field.getOptions().addAll(options);
        }
        return field;
    }

    private void updateExistingFields(List<SchemaFieldsRequest.UpdateFieldRequest> fieldsToUpdate) {
        if (CollectionUtils.isEmpty(fieldsToUpdate)) {
            return;
        }
        for (SchemaFieldsRequest.UpdateFieldRequest dto : fieldsToUpdate) {
            updateField(dto);
        }
    }

    private void updateField(SchemaFieldsRequest.UpdateFieldRequest dto) {
        if (dto == null || dto.getId() == null) {
            throw new IllegalArgumentException("UpdateFieldRequestDto.id is required");
        }

        LayerSchemaField field = fieldRepository.findById(dto.getId())
                .orElseThrow(() -> new IllegalArgumentException("LayerSchemaField not found, id=" + dto.getId()));

        // 필드 기본 정보 업데이트
        updateFieldBasicInfo(field, dto);

        // 옵션 업데이트 (select 타입인 경우)
        updateFieldOptions(field, dto);

        // JPA Cascade 저장
        fieldRepository.save(field);
    }

    private void updateFieldBasicInfo(LayerSchemaField field, SchemaFieldsRequest.UpdateFieldRequest dto) {
        schemaMapper.updateLayerSchemaField(field, dto);

        // 입력 타입이 select가 아니면 기존 옵션 삭제
        if (dto.getInputType() != null && !"select".equalsIgnoreCase(dto.getInputType())) {
            deleteFieldOptionsIfExists(field);
        }
    }

    private void deleteFieldOptionsIfExists(LayerSchemaField field) {
        if (field.getOptions() != null && !field.getOptions().isEmpty()) {
            List<Long> optionIds = field.getOptions().stream()
                    .map(LayerSchemaOption::getId)
                    .filter(Objects::nonNull)
                    .toList();

            if (!optionIds.isEmpty()) {
                optionRepository.deleteAllByIdInBatch(optionIds);
            }
            field.getOptions().clear();
        }
    }

    private void updateFieldOptions(LayerSchemaField field, SchemaFieldsRequest.UpdateFieldRequest dto) {
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

    private void createNewOptions(LayerSchemaField field, List<SchemaFieldsRequest.CreateFieldOptionRequest> optionsToCreate) {
        if (CollectionUtils.isEmpty(optionsToCreate)) {
            return;
        }
        for (SchemaFieldsRequest.CreateFieldOptionRequest dto : optionsToCreate) {
            LayerSchemaOption option = schemaMapper.toLayerSchemaOption(field, dto);
            field.getOptions().add(option);
        }
    }

    private void updateExistingOptions(LayerSchemaField field, List<SchemaFieldsRequest.UpdateFieldOption> optionsToUpdate) {
        if (CollectionUtils.isEmpty(optionsToUpdate)) {
            return;
        }

        Map<Long, LayerSchemaOption> optionIndex = Optional.ofNullable(field.getOptions())
                .orElseGet(Collections::emptyList)
                .stream()
                .filter(o -> o.getId() != null)
                .collect(Collectors.toMap(LayerSchemaOption::getId, Function.identity()));

        for (SchemaFieldsRequest.UpdateFieldOption dto : optionsToUpdate) {
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
        optionRepository.deleteAllByIdInBatch(idsToDelete);
        field.getOptions().removeIf(option -> option.getId() != null && idsToDelete.contains(option.getId()));
    }
}
