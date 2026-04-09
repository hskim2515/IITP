package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.handler.XmlValidationEventHandler;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.service.xml.LocationTrackingXmlStreamReader;
import com.iitp.iitp_rest.service.xml.TransientAwareXmlStreamReader;
import com.iitp.iitp_rest.service.xml.XmlParser;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Marshaller;
import jakarta.xml.bind.Unmarshaller;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@Component("railStationJaxbParser")
public class RailStationJaxbParser implements XmlParser<RailPublicTransitXml> {

    private final JAXBContext jaxbContext;
    private final XMLInputFactory xmlInputFactory;

    public RailStationJaxbParser() {
        try {
            this.jaxbContext = JAXBContext.newInstance(RailPublicTransitXml.class);
            this.xmlInputFactory = XMLInputFactory.newInstance();
        } catch (JAXBException e) {
            throw new IllegalStateException("JAXBContext 초기화 실패", e);
        }
    }

    public byte[] marshal(RailPublicTransitXml xml) throws JAXBException {
        Marshaller marshaller = jaxbContext.createMarshaller();
        marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);
        marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        marshaller.marshal(xml, out);
        return out.toByteArray();
    }

    @Override
    public RailPublicTransitXml parse(InputStream inputStream) {
        LocationTrackingXmlStreamReader locationTracker = null;
        try {
            XMLStreamReader reader = xmlInputFactory.createXMLStreamReader(inputStream);


            TransientAwareXmlStreamReader transientAwareReader =
                    new TransientAwareXmlStreamReader(reader, RailPublicTransitXml.class);

            locationTracker = new LocationTrackingXmlStreamReader(transientAwareReader);


            Unmarshaller unmarshaller = jaxbContext.createUnmarshaller();
            unmarshaller.setEventHandler(new XmlValidationEventHandler());

            return (RailPublicTransitXml) unmarshaller.unmarshal(locationTracker);
        } catch (Exception e) {
            String errorLocation = "알 수 없는 위치";
            if (locationTracker != null) {
                errorLocation = String.format("Element=[%s], Attribute=[%s]",
                        locationTracker.getLastElementName(),
                        locationTracker.getLastAttributeName());
            }
            throw new RuntimeException(String.format("네트워크 XML 파싱 실패. [오류 추정 위치: %s]", errorLocation), e);
        }
    }
}