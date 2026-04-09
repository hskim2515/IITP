package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.SimulationRunXml;
import com.iitp.iitp_rest.util.SftpFileManager;
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

    private final SftpFileManager sftpFileManager;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public SimulationRunXml getByScenarioKey(String scenarioKey) throws IOException {
        String url = remoteUrl + scenarioKey + "/scenario.xml";
        log.info("[SimulationRunService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
    }

    public void saveByScenarioKey(String scenarioKey, SimulationRunXml data) throws Exception {
        byte[] xmlBytes = marshalToXml(data);
        sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "scenario.xml");
        log.info("[SimulationRunService] SFTP 저장 완료: {}/scenario.xml", scenarioKey);
    }

    private SimulationRunXml parse(InputStream is) {
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
