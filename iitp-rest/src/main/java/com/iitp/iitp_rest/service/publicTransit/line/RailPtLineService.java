package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
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
public class RailPtLineService {

    private final SftpFileManager sftpFileManager;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public RailPtLineXml getByScenarioKey(String scenarioKey) throws IOException {
        String url = remoteUrl + scenarioKey + "/railPTLine.xml";
        log.info("[RailPtLineService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
    }

    public void saveByScenarioKey(String scenarioKey, RailPtLineXml data) throws Exception {
        byte[] xmlBytes = marshal(data);
        sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "railPTLine.xml");
        log.info("[RailPtLineService] SFTP 저장 완료: {}/railPTLine.xml", scenarioKey);
    }

    private RailPtLineXml parse(InputStream is) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(RailPtLineXml.class);
            Unmarshaller u = ctx.createUnmarshaller();
            return (RailPtLineXml) u.unmarshal(is);
        } catch (JAXBException e) {
            throw new RuntimeException("railPTLine.xml 파싱 실패", e);
        }
    }

    private byte[] marshal(RailPtLineXml data) throws JAXBException {
        JAXBContext ctx = JAXBContext.newInstance(RailPtLineXml.class);
        Marshaller m = ctx.createMarshaller();
        m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
        m.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        m.marshal(data, out);
        return out.toByteArray();
    }
}
