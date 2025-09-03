package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.RoadResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.xml.stream.XMLStreamException;
import java.io.InputStream;

@Slf4j
@RequiredArgsConstructor
@Service
public class RoadService {
    private final RoadXmlParser roadXmlParser;
    public RoadResponse streamToDto(InputStream is) throws XMLStreamException {
        final long totalStart = System.nanoTime();
        RoadResponse roadDto = roadXmlParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("RoadData streamToDto total:{}", totalEnd-totalStart);
        return roadDto;
    }
    // Map으로 변환하면서 id 설정하는 과정이 필요함.
    //
}
