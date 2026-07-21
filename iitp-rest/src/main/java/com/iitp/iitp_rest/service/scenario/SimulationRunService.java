package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.SimulationRunXml;
import com.iitp.iitp_rest.util.FileStorageService;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Marshaller;
import jakarta.xml.bind.Unmarshaller;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

@Slf4j
@Service
@RequiredArgsConstructor
public class SimulationRunService {

    private final FileStorageService fileStorage;
    private final com.iitp.iitp_rest.repository.ScenarioVersionRepository scenarioVersionRepository;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    /**
     * 버전 폴더 우선 조회 + 부모 scenario key 폴더 폴백 (레거시 공유 레이어 상속) —
     * NextSimRunner.candidateDirs / OdMatrixService 와 동일 규약. 저장은 versionId 폴더.
     */
    public SimulationRunXml getByScenarioKey(String scenarioKey) throws IOException {
        IOException last = null;
        for (String dir : candidateDirs(scenarioKey)) {
            String url = remoteUrl + dir + "/scenario.xml";
            try (InputStream is = new URL(url).openStream()) {
                log.info("[SimulationRunService] fetching: {}", url);
                return parse(is);
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new java.io.FileNotFoundException(scenarioKey + "/scenario.xml");
    }

    private java.util.List<String> candidateDirs(String versionId) {
        String parentKey = scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
        return parentKey.equals(versionId)
                ? java.util.List.of(versionId) : java.util.List.of(versionId, parentKey);
    }

    public void saveByScenarioKey(String scenarioKey, SimulationRunXml data) throws Exception {
        byte[] xmlBytes = marshalToXml(data);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "scenario.xml");
        log.info("[SimulationRunService] SFTP 저장 완료: {}/scenario.xml", scenarioKey);
    }

    public SimulationRunXml parse(InputStream is) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(SimulationRunXml.class);
            Unmarshaller u = ctx.createUnmarshaller();
            return (SimulationRunXml) u.unmarshal(is);
        } catch (JAXBException e) {
            throw new RuntimeException("scenario.xml 파싱 실패", e);
        }
    }

    public byte[] marshalToXml(SimulationRunXml data) throws JAXBException {
        JAXBContext ctx = JAXBContext.newInstance(SimulationRunXml.class);
        Marshaller m = ctx.createMarshaller();
        m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
        m.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        m.marshal(data, out);
        return out.toByteArray();
    }
}
