package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.station.RailStationLogs;
import com.iitp.iitp_rest.model.publicTransit.station.RailStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.station.RailStationVersion;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class RailStationService {


    private final RailStationVersionsRepository railStationVersionsRepository;
    private final RailStationLogsRepository railStationLogsRepository;


    public RailStationVersion getByVersionId(String id) {
        return railStationVersionsRepository.findByVersionId(id).orElse(new RailStationVersion());
    }

    public List<RailStationLogs> getLogsByVersion(String id) {
        return railStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveRailStation(RailStationSaveRequest request, String versionId) {
        RailStationVersion entity = railStationVersionsRepository.findByVersionId(versionId)
                .orElse(new RailStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getData());
        railStationVersionsRepository.save(entity);
        List<RailStationLogs> existingLogs = railStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 20;
        if (existingLogs.size() >= maxLogs) {
            int removeCount = existingLogs.size() - maxLogs + 1;
            List<RailStationLogs> toDelete = existingLogs.subList(0, removeCount);
            railStationLogsRepository.deleteAll(toDelete);
        }

        RailStationLogs entityLog = RailStationLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        railStationLogsRepository.save(entityLog);
    }
}
