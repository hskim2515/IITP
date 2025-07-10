package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationVersion;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class BusStationService {


    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;


    public BusStationVersion getByVersionId(String id) {
        return busStationVersionsRepository.findByVersionId(id).orElse(new BusStationVersion());
    }

    public List<BusStationLogs> getLogsByVersion(String id) {
        return busStationLogsRepository.findByVersionId(id);
    }

    @Transactional
    public void saveBusStation(BusStationSaveRequest request, String versionId) {
        BusStationVersion entity = busStationVersionsRepository.findByVersionId(versionId)
                .orElse(new BusStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getData());
        busStationVersionsRepository.save(entity);
        List<BusStationLogs> existingLogs = busStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 20;
        if (existingLogs.size() >= maxLogs) {
            int removeCount = existingLogs.size() - maxLogs + 1;
            List<BusStationLogs> toDelete = existingLogs.subList(0, removeCount);
            busStationLogsRepository.deleteAll(toDelete);
        }

        BusStationLogs entityLog = BusStationLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        busStationLogsRepository.save(entityLog);
    }
}
