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

    /** versionId 폴더 우선, scenario key 폴더 폴백 — NextSimRunner.candidateDirs 와 동일 규약 */
    private java.util.List<String> candidateDirs(String versionId) {
        String scenarioKey = resolveScenarioKey(versionId);
        return scenarioKey.equals(versionId)
                ? java.util.List.of(versionId) : java.util.List.of(versionId, scenarioKey);
    }

    /**
     * 버전 폴더 우선 조회 + scenario key 폴백. 저장은 항상 versionId 폴더(버전별 격리) —
     * 새 버전은 첫 저장 전까지 부모 시나리오의 OD 를 물려받는 copy-on-write 동작이 된다.
     */
    public OdMatrixXml getByVersionId(String versionId) throws IOException {
        IOException last = null;
        for (String dir : candidateDirs(versionId)) {
            String url = remoteUrl + dir + "/odmatrix.xml";
            try (InputStream is = new URL(url).openStream()) {
                log.info("[OdMatrixService] fetching: {} (versionId={})", url, versionId);
                return parse(is);
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new FileNotFoundException(versionId + "/odmatrix.xml");
    }

    public void saveByVersionId(String versionId, OdMatrixXml odMatrix) throws Exception {
        byte[] xmlBytes = marshal(odMatrix);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "odmatrix.xml");
        log.info("[OdMatrixService] SFTP 저장 완료: {}/odmatrix.xml", versionId);
    }

    public OdMatrixXml parse(InputStream is) {
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
