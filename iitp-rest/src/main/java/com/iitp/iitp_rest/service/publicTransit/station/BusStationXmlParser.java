package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.bus.BusStationData;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitData;
import com.iitp.iitp_rest.service.xml.XmlParser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLEventReader;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.events.StartElement;
import javax.xml.stream.events.XMLEvent;
import java.io.InputStream;
import java.util.*;

import static com.iitp.iitp_rest.util.XmlUtils.*;

@Component
@RequiredArgsConstructor
public class BusStationXmlParser implements XmlParser<PublicTransitData> {

    private final XMLInputFactory xmlInputFactory;

    private static final String TAG_PUBLIC_TRANSIT = "PublicTransit";
    private static final String TAG_STATIONS = "Stations";
    private static final String TAG_STATION = "station";
    private static final String TAG_LINE = "line";

    @Override
    public PublicTransitData parse(InputStream is) throws XMLStreamException {
        XMLEventReader eventReader = xmlInputFactory.createXMLEventReader(is);
        PublicTransitData publicTransit = new PublicTransitData();
        publicTransit.setBusStations(new ArrayList<>());

        while (eventReader.hasNext()) {
            XMLEvent event = eventReader.nextEvent();

            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                if (startElement.getName().getLocalPart().equals(TAG_STATIONS)) {
                    parseStations(eventReader, publicTransit);
                }
            }
            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_PUBLIC_TRANSIT)) {
                break;
            }
        }
        return publicTransit;
    }

    private void parseStations(XMLEventReader reader, PublicTransitData publicTransit) throws XMLStreamException {
        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();
            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                if (startElement.getName().getLocalPart().equals(TAG_STATION)) {
                    publicTransit.getBusStations().add(parseBusStation(reader, startElement));
                }
            }
            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_STATIONS)) {
                return;
            }
        }
    }

    private BusStationData parseBusStation(XMLEventReader reader, StartElement busStationStartElement) throws XMLStreamException {
        BusStationData busStation = new BusStationData();

        parseBusStationAttributes(busStation, busStationStartElement);

        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();

            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                if (startElement.getName().getLocalPart().equals(TAG_LINE)) {
                    String lineList = getStringAttribute(startElement, "list");
                    if (lineList != null && !lineList.isEmpty()) {
                        busStation.setLines(Arrays.asList(lineList.split(" ")));
                    } else {
                        busStation.setLines(Collections.emptyList());
                    }
                }
            }

            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_STATION)) {
                return busStation;
            }
        }
        throw new XMLStreamException("Malformed XML: <station> tag not closed.");
    }

    private void parseBusStationAttributes(BusStationData busStation, StartElement element) {
        busStation.setId(getStringAttribute(element, "id"));
        busStation.setTransitMode(getStringAttribute(element, "transitMode"));
        busStation.setLinkRef(getIntAttribute(element, "link_ref"));
        busStation.setLaneRef(getIntAttribute(element, "lane_ref"));
        busStation.setPos(getDoubleAttribute(element, "pos"));
        busStation.setType(getStringAttribute(element, "type"));
        busStation.setParkingLots(getIntAttribute(element, "parkingLots"));
        busStation.setAddress(getStringAttribute(element, "address"));
        busStation.setCenter(getStringAttribute(element, "center"));
    }
}