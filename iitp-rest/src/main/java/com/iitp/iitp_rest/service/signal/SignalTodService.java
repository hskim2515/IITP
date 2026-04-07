package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.SignalTodXml;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Unmarshaller;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

@Slf4j
@Service
public class SignalTodService {

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public SignalTodXml getByScenarioKey(String scenarioKey) throws IOException {
        String url = remoteUrl + scenarioKey + "/signalTOD.xml";
        log.info("[SignalTodService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
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
}
