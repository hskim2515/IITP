package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.station.BusStationData;
import com.iitp.iitp_rest.model.publicTransit.station.PublicTransitData;
import com.iitp.iitp_rest.service.xml.XmlParser;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLEventReader;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.events.Attribute;
import javax.xml.stream.events.StartElement;
import javax.xml.stream.events.XMLEvent;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

@Component
public class BusStationXmlParser implements XmlParser<PublicTransitData> {
    @Override
    public boolean supports(String rootTagName) {
        return "stations".equals(rootTagName);
    }

    @Override
    public PublicTransitData parse(XMLEventReader eventReader) throws XMLStreamException {
        List<BusStationData> stationList = new ArrayList<>();

        while (eventReader.hasNext()) {
            XMLEvent event = eventReader.nextEvent();

            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                String tagName = startElement.getName().getLocalPart();

                if ("station".equals(tagName)) {
                    BusStationData.BusStationDataBuilder stationBuilder = BusStationData.builder();

                    Iterator<Attribute> attributes = startElement.getAttributes();
                    while (attributes.hasNext()) {
                        Attribute attribute = attributes.next();
                        String attrName = attribute.getName().getLocalPart();
                        String attrValue = attribute.getValue();

                        switch (attrName) {
                            case "id":
                                stationBuilder.id(attrValue);
                                break;
                            case "transitMode":
                                stationBuilder.transitMode(attrValue);
                                break;
                            case "linkRef":
                                stationBuilder.linkRef(Integer.parseInt(attrValue));
                                break;
                            case "laneRef":
                                stationBuilder.laneRef(Integer.parseInt(attrValue));
                                break;
                            case "offset":
                                stationBuilder.offset(Double.parseDouble(attrValue));
                                break;
                            case "type":
                                stationBuilder.type(attrValue);
                                break;
                            case "parkingLots":
                                stationBuilder.parkingLots(Integer.parseInt(attrValue));
                                break;
                            case "address":
                                stationBuilder.address(attrValue);
                                break;
                            case "center":
                                stationBuilder.center(attrValue);
                                break;
                        }
                    }
                    stationList.add(stationBuilder.build());
                }
            }

            if (event.isEndElement() && "stations".equals(event.asEndElement().getName().getLocalPart())) {
                break;
            }
        }

        PublicTransitData publicTransitData = new PublicTransitData();
        publicTransitData.setBusStations(stationList);
        return publicTransitData;
    }
}