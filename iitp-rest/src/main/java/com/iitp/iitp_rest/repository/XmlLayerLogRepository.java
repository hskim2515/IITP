package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface XmlLayerLogRepository extends JpaRepository<XmlLayerLog, Long> {
    List<XmlLayerLog> findByLayerKeyAndVersionIdOrderByCreatedAtAsc(String layerKey, String versionId);
    void deleteByLayerKeyAndVersionId(String layerKey, String versionId);
    /** 버전 삭제 연쇄 정리용 — layerKey 무관하게 이 버전의 모든 편집 로그 삭제 */
    @org.springframework.transaction.annotation.Transactional
    void deleteByVersionId(String versionId);
}
