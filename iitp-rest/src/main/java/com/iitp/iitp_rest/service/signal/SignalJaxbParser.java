package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.handler.XmlValidationEventHandler;

import com.iitp.iitp_rest.model.signal.SignalXml;
import com.iitp.iitp_rest.service.xml.LocationTrackingXmlStreamReader;
import com.iitp.iitp_rest.service.xml.XmlParser;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Unmarshaller;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import java.io.InputStream;

@Component("signalJaxbParser")
public class SignalJaxbParser implements XmlParser<SignalXml> {

    private final JAXBContext jaxbContext;
    private final XMLInputFactory xmlInputFactory;

    public SignalJaxbParser() {
        try {
            this.jaxbContext = JAXBContext.newInstance(SignalXml.class);
            this.xmlInputFactory = XMLInputFactory.newInstance();
        } catch (JAXBException e) {
            throw new IllegalStateException("JAXBContext 초기화 실패", e);
        }
    }

    @Override
    public SignalXml parse(InputStream inputStream) {
        LocationTrackingXmlStreamReader locationTracker = null;
        try {
            XMLStreamReader reader = xmlInputFactory.createXMLStreamReader(inputStream);

            locationTracker = new LocationTrackingXmlStreamReader(reader);

            Unmarshaller unmarshaller = jaxbContext.createUnmarshaller();
            unmarshaller.setEventHandler(new XmlValidationEventHandler());

            return (SignalXml) unmarshaller.unmarshal(locationTracker);
        } catch (Exception e) {
            String errorLocation = "알 수 없는 위치";
            if (locationTracker != null) {
                errorLocation = String.format("Element=[%s], Attribute=[%s]",
                        locationTracker.getLastElementName(),
                        locationTracker.getLastAttributeName());
            }
            throw new RuntimeException(String.format("XML 파싱 실패. [오류 추정 위치: %s]", errorLocation), e);
        }
    }
}