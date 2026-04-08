package com.iitp.iitp_rest.service.xmllayer;

import com.iitp.iitp_rest.model.LogsData;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerLog;
import com.iitp.iitp_rest.model.xmllayer.XmlLayerVersion;
import com.iitp.iitp_rest.repository.XmlLayerLogRepository;
import com.iitp.iitp_rest.repository.XmlLayerVersionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * XML 기반 레이어 공통 버전/이력 서비스.
 * <p>
 * 각 컨트롤러는 layerKey(예: "signal_tod")와 XML fetch 함수를 전달해 사용한다.
 * </p>
 *
 * <pre>
 * GET /{layerKey}/{versionId}         → DB 우선, 없으면 XML
 * GET /{layerKey}/origin/{versionId}  → 항상 XML (편집 전 원본)
 * GET /{layerKey}/histories/{versionId} → 변경 로그 목록
 * POST/{layerKey}/{versionId}         → DB 저장 + 로그 추가 (max 10)
 * </pre>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class XmlLayerVersionService {

    private static final int MAX_LOGS = 10;

    private final XmlLayerVersionRepository versionRepo;
    private final XmlLayerLogRepository     logRepo;

    /**
     * DB(최신)가 있으면 반환, 없으면 xmlFetcher 실행하여 반환.
     *
     * @param layerKey  레이어 식별자 (e.g. "signal_tod")
     * @param versionId 버전/시나리오 키
     * @param xmlFetcher XML 원본을 Map 으로 반환하는 공급자
     */
    public Map<String, Object> getLatest(String layerKey, String versionId,
                                         Supplier<Map<String, Object>> xmlFetcher) {
        Optional<XmlLayerVersion> opt = versionRepo.findByLayerKeyAndVersionId(layerKey, versionId);
        if (opt.isPresent() && opt.get().getData() != null && !opt.get().getData().isEmpty()) {
            log.info("[XmlLayerVersionService] DB 반환 layerKey={} versionId={}", layerKey, versionId);
            return opt.get().getData();
        }
        log.info("[XmlLayerVersionService] XML 반환 layerKey={} versionId={}", layerKey, versionId);
        return xmlFetcher.get();
    }

    /**
     * 항상 XML 원본 반환 (HistoryModal 복원 기준점).
     */
    public Map<String, Object> getOrigin(String layerKey, String versionId,
                                          Supplier<Map<String, Object>> xmlFetcher) {
        return xmlFetcher.get();
    }

    /**
     * 변경 이력 로그 목록 반환.
     */
    public List<XmlLayerLog> getLogs(String layerKey, String versionId) {
        return logRepo.findByLayerKeyAndVersionIdOrderByCreatedAtAsc(layerKey, versionId);
    }

    /**
     * DB 저장 + 변경 로그 추가 (max 10 유지).
     *
     * @param layerKey  레이어 식별자
     * @param versionId 버전/시나리오 키
     * @param data      프론트엔드 currentJsonData 전체
     * @param logs      프론트엔드 mergedLog
     */
    @Transactional
    public void save(String layerKey, String versionId,
                     Map<String, Object> data, LogsData logs) {
        // 1. LATEST 버전 갱신 (upsert)
        XmlLayerVersion entity = versionRepo.findByLayerKeyAndVersionId(layerKey, versionId)
                .orElse(XmlLayerVersion.builder()
                        .layerKey(layerKey)
                        .versionId(versionId)
                        .build());
        entity.setData(data);
        versionRepo.save(entity);

        // 2. 로그 max 초과 시 오래된 것 삭제
        List<XmlLayerLog> existingLogs =
                logRepo.findByLayerKeyAndVersionIdOrderByCreatedAtAsc(layerKey, versionId);
        if (existingLogs.size() >= MAX_LOGS) {
            int removeCount = existingLogs.size() - MAX_LOGS + 1;
            logRepo.deleteAll(existingLogs.subList(0, removeCount));
        }

        // 3. 새 로그 추가
        logRepo.save(XmlLayerLog.builder()
                .layerKey(layerKey)
                .versionId(versionId)
                .data(logs)
                .build());

        log.info("[XmlLayerVersionService] 저장 완료 layerKey={} versionId={}", layerKey, versionId);
    }
}
