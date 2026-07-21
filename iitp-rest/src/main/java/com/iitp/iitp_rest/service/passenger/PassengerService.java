package com.iitp.iitp_rest.service.passenger;

import com.iitp.iitp_rest.model.passenger.PassengerXml;
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

/**
 * passenger.xml(승객 OD 수요, 선택) 버전 스토리지 서비스. OdMatrixService와 동일한 구조.
 *
 * <p>OD Matrix와 달리 route-generator 터미널 id 대역 보정(OdTerminalIdBandService)은
 * 아직 적용하지 않는다 — 승객 노드가 원인이 되는 동일한 크래시가 관측되면 그때 도입한다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PassengerService {

    private final FileStorageService fileStorage;
    private final ScenarioVersionRepository scenarioVersionRepository;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    private String resolveScenarioKey(String versionId) {
        return scenarioVersionRepository.findByKeyWithScenario(versionId)
                .map(v -> v.getScenario().getKey())
                .orElse(versionId);
    }

    private java.util.List<String> candidateDirs(String versionId) {
        String scenarioKey = resolveScenarioKey(versionId);
        return scenarioKey.equals(versionId)
                ? java.util.List.of(versionId) : java.util.List.of(versionId, scenarioKey);
    }

    public PassengerXml getByVersionId(String versionId) throws IOException {
        IOException last = null;
        for (String dir : candidateDirs(versionId)) {
            String url = remoteUrl + dir + "/passenger.xml";
            try (InputStream is = new URL(url).openStream()) {
                log.info("[PassengerService] fetching: {} (versionId={})", url, versionId);
                return parse(is);
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new FileNotFoundException(versionId + "/passenger.xml");
    }

    public void saveByVersionId(String versionId, PassengerXml passenger) throws Exception {
        byte[] xmlBytes = marshal(passenger);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), versionId, "passenger.xml");
        log.info("[PassengerService] SFTP 저장 완료: {}/passenger.xml", versionId);
    }

    public PassengerXml parse(InputStream is) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(PassengerXml.class);
            Unmarshaller u = ctx.createUnmarshaller();
            return (PassengerXml) u.unmarshal(is);
        } catch (JAXBException e) {
            throw new RuntimeException("passenger.xml 파싱 실패", e);
        }
    }

    private byte[] marshal(PassengerXml passenger) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(PassengerXml.class);
            Marshaller m = ctx.createMarshaller();
            m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
            m.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            m.marshal(passenger, out);
            return out.toByteArray();
        } catch (JAXBException e) {
            throw new RuntimeException("passenger.xml 마샬링 실패", e);
        }
    }
}
