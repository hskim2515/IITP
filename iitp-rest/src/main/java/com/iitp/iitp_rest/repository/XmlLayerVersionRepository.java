package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface XmlLayerVersionRepository extends JpaRepository<XmlLayerVersion, Long> {
    Optional<XmlLayerVersion> findByLayerKeyAndVersionId(String layerKey, String versionId);
}
