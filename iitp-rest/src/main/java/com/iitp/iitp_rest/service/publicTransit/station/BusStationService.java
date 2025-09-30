package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.bus.BusStationLogs;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationSaveRequest;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationVersion;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXml;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.util.XmlUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class BusStationService {

    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;
    private final BusStationJaxbParser busStationJaxbParser;

    private final ScenarioRepository scenarioRepository;

    public BusStationVersion getByVersionId(String versionId) {
        return busStationVersionsRepository.findByVersionId(versionId).orElse(new BusStationVersion());
    }

    public List<BusStationLogs> getBusStationLogsByVersionId(String versionId) {
        return busStationLogsRepository.findByVersionId(versionId);
    }

    @Transactional
    public void saveBusStationsByVersionId(BusStationSaveRequest request, String versionId) {
        BusStationVersion entity = busStationVersionsRepository.findByVersionId(versionId)
                .orElse(new BusStationVersion());
        entity.setVersionId(versionId);
        entity.setData(request.getData());
        busStationVersionsRepository.save(entity);
        List<BusStationLogs> existingLogs = busStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 10;
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

    public PublicTransitXml getBusStationXmlByVersionId(String versionId) {
        String path = versionId + "/publicTransit.xml";
        InputStream is = XmlUtils.loadXmlAsStream(path);
        return streamToDto(is);
    }


    public PublicTransitXml streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        PublicTransitXml dto = busStationJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("BusPublicTransitXmlResponse streamToDto total:{}", totalEnd - totalStart);
        return dto;
    }

}
