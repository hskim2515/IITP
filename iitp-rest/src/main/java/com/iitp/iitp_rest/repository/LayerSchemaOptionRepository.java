package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.LayerSchemaOption;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface LayerSchemaOptionRepository extends JpaRepository<LayerSchemaOption, Long> {

    List<LayerSchemaOption> findAllByFieldId(Long fieldId);
    void deleteAllByFieldId(Long fieldId);
    List<LayerSchemaOption> findAllByField_LayerSchema_Layer_Id(Long layerId);
    List<LayerSchemaOption> findAllByField_LayerSchema_Layer_IdIn(Collection<Long> layerId);
}
