package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.mapper.publicTransit.BusStationMapper;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import com.iitp.iitp_rest.model.publicTransit.bus.*;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class BusStationService {

    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;
    private final BusStationJaxbParser busStationJaxbParser;
    private final BusStationMapper busStationMapper;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    /**
     * DB(최신 버전)가 있으면 DB에서, 없으면 XML에서 반환 (Signal과 동일한 패턴)
     */
    public PublicTransitResponse getBusStationsByVersionId(String versionId) throws IOException {
        return busStationVersionsRepository.findByVersionId(versionId)
                .filter(v -> v.getData() != null && !v.getData().isEmpty())
                .map(v -> {
                    PublicTransitResponse res = new PublicTransitResponse();
                    res.setBusStations(toResponseList(v.getData()));
                    log.info("[BusStationService] DB에서 {} 건 반환", v.getData().size());
                    return res;
                })
                .orElseGet(() -> {
                    try {
                        log.info("[BusStationService] DB 없음, XML에서 반환");
                        return getFromXml(versionId);
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                });
    }

    /**
     * XML origin 데이터 반환 (HistoryModal 복원 기준점)
     */
    public PublicTransitResponse getOriginByVersionId(String versionId) throws IOException {
        return getFromXml(versionId);
    }

    /**
     * 변경 이력 목록 반환
     */
    public List<BusStationLogs> getLogsByVersionId(String versionId) {
        return busStationLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);
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
            busStationLogsRepository.deleteAll(existingLogs.subList(0, removeCount));
        }

        BusStationLogs entityLog = BusStationLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();
        busStationLogsRepository.save(entityLog);
    }

    private PublicTransitResponse getFromXml(String versionId) throws IOException {
        InputStream is = new URL(remoteUrl + versionId + "/roadStation.xml").openStream();
        PublicTransitXml xml = busStationJaxbParser.parse(is);
        return busStationMapper.toResponse(xml);
    }

    private List<BusStationResponse> toResponseList(List<BusStationData> dataList) {
        return dataList.stream().map(d -> {
            BusStationResponse r = new BusStationResponse();
            r.setId(d.getId());
            r.setTransitMode(d.getTransitMode() != null ? TransitMode.fromValue(d.getTransitMode()) : null);
            r.setLinkRef(d.getLinkRef());
            r.setLaneRef(d.getLaneRef());
            r.setOffset(d.getOffset());
            r.setType(d.getType() != null ? StationType.fromValue(d.getType()) : null);
            r.setParkingLots(d.getParkingLots());
            r.setAddress(d.getAddress());
            r.setCenter(d.getCenter());
            r.setLine(d.getLine());
            return r;
        }).toList();
    }
}
