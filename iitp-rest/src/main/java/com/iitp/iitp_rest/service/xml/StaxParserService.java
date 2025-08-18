package com.iitp.iitp_rest.service.xml;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import javax.xml.stream.XMLEventReader;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.events.XMLEvent;
import java.io.InputStream;
import java.util.List;

@Service
@RequiredArgsConstructor
public class StaxParserService {
    private final List<XmlParser<?>> parsers;
    private final XMLInputFactory xmlInputFactory;

    public Object parse(InputStream inputStream) throws XMLStreamException {
        XMLEventReader eventReader = xmlInputFactory.createXMLEventReader(inputStream);

        // XML의 루트 태그 이름을 확인
        String rootTagName = getRootTagName(eventReader);

        // 해당 루트 태그를 지원하는 파서를 찾음
        XmlParser<?> parser = parsers.stream()
                .filter(p -> p.supports(rootTagName))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("지원하지 않는 XML 형식입니다: " + rootTagName));

        // 찾은 파서에게 파싱 작업을 위임
        return parser.parse(eventReader);
    }

    private String getRootTagName(XMLEventReader eventReader) throws XMLStreamException  {
        while (eventReader.hasNext()) {
            XMLEvent event = eventReader.peek(); // 다음 이벤트를 제거하지 않고 확인
            if (event.isStartElement()) {
                return event.asStartElement().getName().getLocalPart();
            }
            eventReader.nextEvent(); // 다음으로 이동
        }
        throw new IllegalStateException("루트 태그를 찾을 수 없습니다.");
    }
}
