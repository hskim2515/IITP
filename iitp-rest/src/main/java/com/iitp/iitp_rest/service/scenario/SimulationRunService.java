package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.model.scenario.SimulationRunXml;
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
public class SimulationRunService {

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public SimulationRunXml getByScenarioKey(String scenarioKey) throws IOException {
        String url = remoteUrl + scenarioKey + "/scenario.xml";
        log.info("[SimulationRunService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
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
}
