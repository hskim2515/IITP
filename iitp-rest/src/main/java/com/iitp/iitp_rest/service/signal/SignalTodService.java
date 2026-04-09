package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.SignalTodXml;
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
public class SignalTodService {

    private final SftpFileManager sftpFileManager;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public SignalTodXml getByScenarioKey(String scenarioKey) throws IOException {
        String url = remoteUrl + scenarioKey + "/signalTOD.xml";
        log.info("[SignalTodService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
    }

    public void saveByScenarioKey(String scenarioKey, SignalTodXml data) throws Exception {
        byte[] xmlBytes = marshalToXml(data, SignalTodXml.class);
        sftpFileManager.uploadFile(new ByteArrayInputStream(xmlBytes), scenarioKey, "signalTOD.xml");
        log.info("[SignalTodService] SFTP 저장 완료: {}/signalTOD.xml", scenarioKey);
    }

    private SignalTodXml parse(InputStream is) {
        try {
            JAXBContext ctx = JAXBContext.newInstance(SignalTodXml.class);
            Unmarshaller u = ctx.createUnmarshaller();
            return (SignalTodXml) u.unmarshal(is);
        } catch (JAXBException e) {
            throw new RuntimeException("signalTOD.xml 파싱 실패", e);
        }
    }

    public <T> byte[] marshalToXml(T obj, Class<T> clazz) throws JAXBException {
        JAXBContext ctx = JAXBContext.newInstance(clazz);
        Marshaller m = ctx.createMarshaller();
        m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
        m.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        m.marshal(obj, out);
        return out.toByteArray();
    }
}
