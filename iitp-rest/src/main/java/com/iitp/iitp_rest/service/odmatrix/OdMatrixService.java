package com.iitp.iitp_rest.service.odmatrix;

import com.iitp.iitp_rest.model.odmatrix.OdMatrixXml;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
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
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

@Slf4j
@Service
@RequiredArgsConstructor
public class OdMatrixService {

    private final FileStorageService fileStorage;
    private final ScenarioVersionRepository scenarioVersionRepository;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    /** versionId → scenario key 변환 (없으면 versionId 그대로 사용) */
    private String resolveScenarioKey(String versionId) {
        return scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
    }

    public OdMatrixXml getByVersionId(String versionId) throws IOException {
        String scenarioKey = resolveScenarioKey(versionId);
        String url = remoteUrl + scenarioKey + "/odmatrix.xml";
        log.info("[OdMatrixService] fetching: {} (versionId={}, scenarioKey={})", url, versionId, scenarioKey);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
    }

    public void saveByVersionId(String versionId, OdMatrixXml odMatrix) throws Exception {
        String scenarioKey = resolveScenarioKey(versionId);
        byte[] xmlBytes = marshal(odMatrix);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "odmatrix.xml");
        log.info("[OdMatrixService] SFTP 저장 완료: {}/odmatrix.xml (versionId={}, scenarioKey={})", scenarioKey, versionId, scenarioKey);
    }

    private OdMatrixXml parse(InputStream is) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(OdMatrixXml.class);
            Unmarshaller u = ctx.createUnmarshaller();
            return (OdMatrixXml) u.unmarshal(is);
        } catch (JAXBException e) {
            throw new RuntimeException("odmatrix.xml 파싱 실패", e);
        }
    }

    private byte[] marshal(OdMatrixXml odMatrix) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(OdMatrixXml.class);
            Marshaller m = ctx.createMarshaller();
            m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
            m.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            m.marshal(odMatrix, out);
            return out.toByteArray();
        } catch (JAXBException e) {
            throw new RuntimeException("odmatrix.xml 마샬링 실패", e);
        }
    }
}
