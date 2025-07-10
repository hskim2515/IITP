package com.iitp.iitp_rest.service.pavementMarking;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingSaveRequest;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import com.iitp.iitp_rest.repository.PavementMarkingLogsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class PavementMarkingService {

    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository;
    private final PavementMarkingLogsRepository pavementMarkingLogsRepository;


    public PavementMarkingVersion getPavementMarking(String id) {
        return pavementMarkingVersionsRepository.findByVersionId(id).orElse(new PavementMarkingVersion());
    }

    public List<PavementMarkingLogs> getLogsByVersion(String id) {
        return pavementMarkingLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void savePavementMarking(PavementMarkingSaveRequest request, String versionId) {
        PavementMarkingVersion version = pavementMarkingVersionsRepository.findByVersionId(versionId)
                .orElse(new PavementMarkingVersion());

        version.setVersionId(versionId);
        version.setData(request.getData());
        pavementMarkingVersionsRepository.save(version);

        List<PavementMarkingLogs> existingLogs = pavementMarkingLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 20;
        if (existingLogs.size() >= maxLogs) {
            int removeCount = existingLogs.size() - maxLogs + 1;
            List<PavementMarkingLogs> toDelete = existingLogs.subList(0, removeCount);
            pavementMarkingLogsRepository.deleteAll(toDelete);
        }

        PavementMarkingLogs logs = PavementMarkingLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        pavementMarkingLogsRepository.save(logs);
    }

}
