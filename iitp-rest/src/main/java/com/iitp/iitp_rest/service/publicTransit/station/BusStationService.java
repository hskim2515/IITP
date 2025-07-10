package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.BaseEntity;
import com.iitp.iitp_rest.model.pavementMarking.JsonSaveRequest;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import com.iitp.iitp_rest.model.pavementMarking.UpdateLog;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.station.BusStationVersion;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

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
    public void saveBusStation(JsonSaveRequest request, String versionId) {
        BusStationVersion entity = busStationVersionsRepository.findByVersionId(versionId)
                .orElse(new BusStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getGeojson());;
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
                .data(request.getLogJson())
                .build();

        busStationLogsRepository.save(entityLog);
    }
}
