package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
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
public class BusPtLineService {

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public BusPtLinesXml getDefault(String scenarioKey) throws IOException {
        return fetch(scenarioKey, "roadPTline.xml");
    }

    public BusPtLinesXml getWeekday(String scenarioKey) throws IOException {
        return fetch(scenarioKey, "roadPTline - weekday.xml");
    }

    public BusPtLinesXml getWeekend(String scenarioKey) throws IOException {
        return fetch(scenarioKey, "roadPTline - weekend.xml");
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
}
