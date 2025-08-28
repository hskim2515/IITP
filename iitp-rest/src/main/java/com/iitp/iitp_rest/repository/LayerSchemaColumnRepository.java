package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.column.LayerSchemaColumn;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LayerSchemaColumnRepository extends JpaRepository<LayerSchemaColumn, Long> {
}
