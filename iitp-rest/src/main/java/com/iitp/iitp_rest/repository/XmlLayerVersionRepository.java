package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface XmlLayerVersionRepository extends JpaRepository<XmlLayerVersion, Long> {
    Optional<XmlLayerVersion> findByLayerKeyAndVersionId(String layerKey, String versionId);
    void deleteByLayerKeyAndVersionId(String layerKey, String versionId);
    /** 버전 삭제 연쇄 정리용 — layerKey 무관하게 이 버전의 모든 레이어 레코드 삭제 */
    @org.springframework.transaction.annotation.Transactional
    void deleteByVersionId(String versionId);
}
