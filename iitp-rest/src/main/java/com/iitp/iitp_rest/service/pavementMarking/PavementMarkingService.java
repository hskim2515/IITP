package com.iitp.iitp_rest.service.pavementMarking;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import com.iitp.iitp_rest.model.pavementMarking.UpdateLog;
import com.iitp.iitp_rest.repository.PavementMarkingLogsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static org.hibernate.query.sqm.tree.SqmNode.log;

@Service
@RequiredArgsConstructor
public class PavementMarkingService {

    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository;
    private final PavementMarkingLogsRepository pavementMarkingLogsRepository;


    public PavementMarkingVersion getByVersionId(String id) {
        return pavementMarkingVersionsRepository.findByVersionId(id).orElse(new PavementMarkingVersion());
    }

    public List<PavementMarkingLogs> getLogsByVersion(String id) {
        return pavementMarkingLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void savePavementMarking(String versionId, Map<String, Object> geojson, List<UpdateLog> logs) {
        PavementMarkingVersion entity = pavementMarkingVersionsRepository.findByVersionId(versionId)
                .orElse(new PavementMarkingVersion());
        entity.setVersionId(versionId);
        entity.setData(geojson);
        pavementMarkingVersionsRepository.save(entity);

        pavementMarkingLogsRepository.deleteByVersionId(versionId);
        pavementMarkingLogsRepository.saveAll(convertToLogEntities(versionId, logs));
    }

    private List<PavementMarkingLogs> convertToLogEntities(String versionId, List<UpdateLog> logs) {
        return logs.stream()
                .map(log -> {
                    PavementMarkingLogs entity = new PavementMarkingLogs();
                    entity.setVersionId(versionId);
                    entity.setCreatedAt(log.getTimestamp());
                    entity.setData(log.getJson());
                    return entity;
                })
                .toList();
    }
}
