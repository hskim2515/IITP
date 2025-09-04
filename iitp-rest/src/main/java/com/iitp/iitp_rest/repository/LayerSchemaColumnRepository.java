package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.schema.LayerSchemaConfig;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LayerSchemaColumnRepository extends JpaRepository<LayerSchemaConfig, Long> {
}
