package com.iitp.iitp_rest.service.pavementMarking;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingData;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingSaveRequest;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingLogs;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
import com.iitp.iitp_rest.repository.PavementMarkingLogsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

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
        PavementMarkingVersion latest = pavementMarkingVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST).orElse(new PavementMarkingVersion());

        latest.setVersionId(versionId);
        latest.setVersionRole(BaseVersion.VersionRole.LATEST);
        latest.setData(request.getData());
        pavementMarkingVersionsRepository.save(latest);

        List<PavementMarkingLogs> existingLogs = pavementMarkingLogsRepository.findByVersionIdOrderByCreatedAtAsc(versionId);

        int maxLogs = 10;
        if (existingLogs.size() >= maxLogs) {
            PavementMarkingVersion origin = pavementMarkingVersionsRepository
                    .findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN)
                    .orElse(new PavementMarkingVersion());

            origin.setVersionId(versionId);
            origin.setVersionRole(BaseVersion.VersionRole.ORIGIN);
            origin.setData(latest.getData());
            pavementMarkingVersionsRepository.save(origin);

            int removeCount = existingLogs.size() - (maxLogs - 1);
            if (removeCount > 0) {
                List<PavementMarkingLogs> toDelete = existingLogs.subList(0, removeCount);
                pavementMarkingLogsRepository.deleteAll(toDelete);
            }
        }

        PavementMarkingLogs logs = PavementMarkingLogs.builder()
                .versionId(versionId)
                .data(request.getLogs())
                .build();

        pavementMarkingLogsRepository.save(logs);
    }

    @Transactional
    public List<PavementMarkingData> getDataFromXml(String versionId) throws Exception {
        List<PavementMarkingData> markingResponses = new ArrayList<>();

        try (InputStream is = getClass().getClassLoader().getResourceAsStream(versionId + "/pavementMarking.xml")) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            NodeList nodeList = doc.getElementsByTagName("marking");
            for (int i = 0; i < nodeList.getLength(); i++) {
                Element markingEl = (Element) nodeList.item(i);

                PavementMarkingData response = new PavementMarkingData();
                response.setId(markingEl.getAttribute("id"));
                response.setLaneRef(Integer.valueOf(markingEl.getAttribute("lane_ref")));
                response.setLinkRef(Integer.valueOf(markingEl.getAttribute("link_ref")));
                response.setCellId(Integer.valueOf(markingEl.getAttribute("cell_id")));
                response.setOffset(Double.valueOf(markingEl.getAttribute("offset")));
                response.setMarkingType(markingEl.getAttribute("marking_type"));
                response.setAngle(Double.valueOf(markingEl.getAttribute("angle")));

                markingResponses.add(response);
            }
        }

        // ORIGIN 버전 없는 경우 최초 저장
        Optional<PavementMarkingVersion> originOpt =
                pavementMarkingVersionsRepository.findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.ORIGIN);

        if (originOpt.isEmpty()) {
            pavementMarkingLogsRepository.deleteByVersionId(versionId);

            PavementMarkingVersion originVersion = new PavementMarkingVersion();
            originVersion.setVersionId(versionId);
            originVersion.setVersionRole(BaseVersion.VersionRole.ORIGIN);
            originVersion.setData(markingResponses);
            pavementMarkingVersionsRepository.save(originVersion);

            PavementMarkingVersion latestVersion = new PavementMarkingVersion();
            latestVersion.setVersionId(versionId);
            latestVersion.setVersionRole(BaseVersion.VersionRole.LATEST);
            latestVersion.setData(markingResponses);
            pavementMarkingVersionsRepository.save(latestVersion);
        }

        return markingResponses;
    }

    public PavementMarkingVersion getDataFromDatabase(String versionId) {
        return pavementMarkingVersionsRepository
                .findByVersionIdAndVersionRole(versionId, BaseVersion.VersionRole.LATEST)
                .orElse(new PavementMarkingVersion());
    }

    public PavementMarkingVersion getOriginData(String versionId) {
        return pavementMarkingVersionsRepository.findByVersionIdAndVersionRole(versionId,BaseVersion.VersionRole.ORIGIN).orElse(new PavementMarkingVersion());
    }

}
