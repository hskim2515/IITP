package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXmlResponse;
import com.iitp.iitp_rest.service.xml.XmlParser;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Unmarshaller;
import org.springframework.stereotype.Component;

import java.io.InputStream;

@Component("networkJaxbParser")
public class NetworkJaxbParser implements XmlParser<NetworkXmlResponse> {

    private final JAXBContext jaxbContext;

    public NetworkJaxbParser() {
        try {
            this.jaxbContext = JAXBContext.newInstance(NetworkXmlResponse.class);
        } catch (JAXBException e) {
            throw new IllegalStateException("JAXBContext 초기화 실패", e);
        }
    }

    @Override
    public NetworkXmlResponse parse(InputStream inputStream) {
        try {
            Unmarshaller unmarshaller = jaxbContext.createUnmarshaller();
            return (NetworkXmlResponse) unmarshaller.unmarshal(inputStream);
        } catch (JAXBException e) {
            throw new RuntimeException("네트워크 XML 파싱 실패", e);
        }
    }
}