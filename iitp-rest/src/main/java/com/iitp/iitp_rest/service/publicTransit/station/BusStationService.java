package com.iitp.iitp_rest.service.publicTransit.station;

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
    public void saveBusStation(String versionId, Map<String, Object> geojson, List<UpdateLog> logs) {
        BusStationVersion entity = busStationVersionsRepository.findByVersionId(versionId)
                .orElse(new BusStationVersion());
        entity.setVersionId(versionId);
        entity.setData(geojson);
        busStationVersionsRepository.save(entity);

        busStationLogsRepository.deleteByVersionId(versionId);
        busStationLogsRepository.saveAll(convertToLogEntities(versionId, logs));
    }

    private List<BusStationLogs> convertToLogEntities(String versionId, List<UpdateLog> logs) {
        return logs.stream()
                .map(log -> {
                    BusStationLogs entity = new BusStationLogs();
                    entity.setVersionId(versionId);
                    entity.setCreatedAt(log.getTimestamp());
                    entity.setData(log.getJson());
                    return entity;
                })
                .toList();
    }
}
