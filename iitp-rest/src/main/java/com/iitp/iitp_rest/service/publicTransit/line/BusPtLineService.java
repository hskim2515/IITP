package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
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
public class BusPtLineService {

    private final FileStorageService fileStorage;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public BusPtLinesXml getDefault(String scenarioKey) throws IOException {
        return fetch(scenarioKey, "roadPTline.xml");
    }

    public BusPtLinesXml getWeekday(String scenarioKey) throws IOException {
        return fetch(scenarioKey, "roadPTline-weekday.xml");
    }

    public BusPtLinesXml getWeekend(String scenarioKey) throws IOException {
        return fetch(scenarioKey, "roadPTline-weekend.xml");
    }

    public void saveDefault(String scenarioKey, BusPtLinesXml data) throws Exception {
        upload(scenarioKey, "roadPTline.xml", data);
    }

    public void saveWeekday(String scenarioKey, BusPtLinesXml data) throws Exception {
        upload(scenarioKey, "roadPTline-weekday.xml", data);
    }

    public void saveWeekend(String scenarioKey, BusPtLinesXml data) throws Exception {
        upload(scenarioKey, "roadPTline-weekend.xml", data);
    }

    private void upload(String scenarioKey, String fileName, BusPtLinesXml data) throws Exception {
        byte[] xmlBytes = marshalToXml(data);
        fileStorage.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, fileName);
        log.info("[BusPtLineService] SFTP 저장 완료: {}/{}", scenarioKey, fileName);
    }

    private BusPtLinesXml fetch(String scenarioKey, String fileName) throws IOException {
        String url = remoteUrl + scenarioKey + "/" + fileName;
        log.info("[BusPtLineService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
    }

    private BusPtLinesXml parse(InputStream is) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(BusPtLinesXml.class);
            Unmarshaller u = ctx.createUnmarshaller();
            return (BusPtLinesXml) u.unmarshal(is);
        } catch (JAXBException e) {
            throw new RuntimeException("roadPTline XML 파싱 실패", e);
        }
    }

    public byte[] marshalToXml(BusPtLinesXml data) throws JAXBException {
        JAXBContext ctx = JAXBContext.newInstance(BusPtLinesXml.class);
        Marshaller m = ctx.createMarshaller();
        m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
        m.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        m.marshal(data, out);
        return out.toByteArray();
    }
}
