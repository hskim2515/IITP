package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface XmlLayerLogRepository extends JpaRepository<XmlLayerLog, Long> {
    List<XmlLayerLog> findByLayerKeyAndVersionIdOrderByCreatedAtAsc(String layerKey, String versionId);
    void deleteByLayerKeyAndVersionId(String layerKey, String versionId);
}
