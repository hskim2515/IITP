package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
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
public class RailPtLineService {

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public RailPtLineXml getByScenarioKey(String scenarioKey) throws IOException {
        String url = remoteUrl + scenarioKey + "/railPTLine.xml";
        log.info("[RailPtLineService] fetching: {}", url);
        try (InputStream is = new URL(url).openStream()) {
            return parse(is);
        }
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
}
