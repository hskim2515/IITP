package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.mapper.publicTransit.BusStationMapper;
import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import com.iitp.iitp_rest.model.publicTransit.bus.*;
import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.iitp.iitp_rest.util.RemoteXmlFetch;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class BusStationService {

    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;
    private final BusStationJaxbParser busStationJaxbParser;
    private final BusStationMapper busStationMapper;
    private final FileStorageService fileStorage;

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
                .orElseGet(() -> {
                    BusStationVersion v = new BusStationVersion();
                    v.setVersionRole(BaseVersion.VersionRole.LATEST);
                    return v;
                });
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

        // DB 저장과 동시에 실제 roadStation.xml 파일도 SFTP에 동기화한다(signal.xml,
        // BusPtLineController/RailPtLineController와 동일 패턴). 이게 없으면 지금까지처럼
        // import(파일 업로드)로만 실제 SFTP 파일이 생성되고, 앱의 일반 저장 경로는 DB
        // 캐시에만 반영돼 NextSim 실행(roadStation.xml)에 전혀 반영되지 않는다.
        try {
            PublicTransitXml xml = toPublicTransitXmlFromData(request.getData());
            byte[] xmlBytes = busStationJaxbParser.marshal(xml);
            fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "roadStation.xml");
            log.info("[BusStationService] roadStation.xml 저장 완료: {}/roadStation.xml", versionId);
        } catch (Exception e) {
            log.warn("[BusStationService] roadStation.xml 파일 동기화 실패(DB는 정상 저장됨): {}", e.getMessage());
        }
    }

    /** List&lt;BusStationData&gt;(프론트 저장 요청) → PublicTransitXml. toPublicTransitXml과
     *  거의 동일하나, BusStationData는 transitMode/type이 이미 String이라(Response는 enum)
     *  XmlJavaTypeAdapter 대상 enum으로 별도 변환이 필요하다. */
    private PublicTransitXml toPublicTransitXmlFromData(List<BusStationData> stations) {
        List<BusStationXml> xmlStations = (stations == null ? List.<BusStationData>of() : stations).stream().map(d -> {
            BusStationXml x = new BusStationXml();
            try { x.setId(Long.parseLong(d.getId())); } catch (Exception ignore) {}
            if (d.getTransitMode() != null) x.setTransitMode(TransitMode.fromValue(d.getTransitMode()));
            x.setLinkRef(d.getLinkRef());
            x.setLaneRef(d.getLaneRef() != null ? String.valueOf(d.getLaneRef()) : null);
            x.setOffset(d.getOffset());
            if (d.getType() != null) x.setType(StationType.fromValue(d.getType()));
            x.setParkingLots(d.getParkingLots() != null ? String.valueOf(d.getParkingLots()) : null);
            x.setCenter(d.getCenter());
            if (d.getLine() != null) {
                BusLineXml line = new BusLineXml();
                line.setList(d.getLine().getList());
                x.setLine(line);
            }
            return x;
        }).toList();
        PublicTransitXml xml = new PublicTransitXml();
        xml.setBusStations(xmlStations);
        return xml;
    }

    /**
     * DB(또는 XML fallback) 데이터를 PublicTransitXml로 변환 후 marshal
     */
    public byte[] exportAsXml(String versionId) throws Exception {
        PublicTransitResponse response = getBusStationsByVersionId(versionId);
        PublicTransitXml xml = toPublicTransitXml(response.getBusStations());
        return busStationJaxbParser.marshal(xml);
    }

    private PublicTransitXml toPublicTransitXml(List<BusStationResponse> stations) {
        List<BusStationXml> xmlStations = stations.stream().map(r -> {
            BusStationXml x = new BusStationXml();
            try { x.setId(Long.parseLong(r.getId())); } catch (Exception ignore) {}
            x.setTransitMode(r.getTransitMode());
            x.setLinkRef(r.getLinkRef());
            x.setLaneRef(r.getLaneRef() != null ? String.valueOf(r.getLaneRef()) : null);
            x.setOffset(r.getOffset());
            x.setType(r.getType());
            x.setParkingLots(r.getParkingLots() != null ? String.valueOf(r.getParkingLots()) : null);
            x.setCenter(r.getCenter());
            if (r.getLine() != null) {
                BusLineXml line = new BusLineXml();
                line.setList(r.getLine().getList());
                x.setLine(line);
            }
            return x;
        }).toList();
        PublicTransitXml xml = new PublicTransitXml();
        xml.setBusStations(xmlStations);
        return xml;
    }

    /** List&lt;BusStationResponse&gt; → List&lt;BusStationData&gt; (XML 임포트 → DB 저장용). 필드가 거의 1:1 대응. */
    public List<BusStationData> toDataList(List<BusStationResponse> responses) {
        return responses.stream().map(r -> {
            BusStationData d = new BusStationData();
            d.setId(r.getId());
            d.setTransitMode(r.getTransitMode() != null ? r.getTransitMode().getValue() : null);
            d.setLinkRef(r.getLinkRef());
            d.setLaneRef(r.getLaneRef());
            d.setOffset(r.getOffset());
            d.setType(r.getType() != null ? r.getType().getValue() : null);
            d.setParkingLots(r.getParkingLots());
            d.setAddress(r.getAddress());
            d.setCenter(r.getCenter());
            d.setLine(r.getLine());
            return d;
        }).toList();
    }

    /** roadStation.xml 업로드 → 파싱 + DB 저장 + SFTP 동기화 */
    @Transactional
    public PublicTransitResponse importFromXml(byte[] xmlBytes, String versionId) throws Exception {
        PublicTransitXml xml = busStationJaxbParser.parse(new ByteArrayInputStream(xmlBytes));
        PublicTransitResponse response = busStationMapper.toResponse(xml);

        BusStationSaveRequest request = new BusStationSaveRequest();
        request.setData(toDataList(response.getBusStations()));
        request.setLogs(new com.iitp.iitp_rest.model.LogsData());
        saveBusStationsByVersionId(request, versionId);

        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "roadStation.xml");
        return response;
    }

    private PublicTransitResponse getFromXml(String versionId) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/roadStation.xml");
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
