package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.station.*;
import com.iitp.iitp_rest.service.xml.XmlParser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLEventReader;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.events.StartElement;
import javax.xml.stream.events.XMLEvent;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;

import static com.iitp.iitp_rest.util.XmlUtils.*;

@Component
@RequiredArgsConstructor
public class RailStationXmlParser implements XmlParser<RailPublicTransitData> {

    private final XMLInputFactory xmlInputFactory;

    private static final String TAG_RAIL_PUBLIC_TRANSIT = "RailPublicTransit";
    private static final String TAG_RAIL_STATIONS = "railStations";
    private static final String TAG_RAIL_STATION = "railStation";
    private static final String TAG_EXIT = "exit";
    private static final String TAG_TIMETABLE = "timetable";


    @Override
    public RailPublicTransitData parse(InputStream is) throws XMLStreamException {
        XMLEventReader eventReader = xmlInputFactory.createXMLEventReader(is);
        RailPublicTransitData railPublicTransit = new RailPublicTransitData();
        railPublicTransit.setRailStations(new ArrayList<>());

        while (eventReader.hasNext()) {
            XMLEvent event = eventReader.nextEvent();

            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                if (startElement.getName().getLocalPart().equals(TAG_RAIL_STATIONS)) {
                    parseRailStations(eventReader, railPublicTransit);
                }
            }
            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_RAIL_PUBLIC_TRANSIT)) {
                break;
            }
        }
        return railPublicTransit;
    }

    private void parseRailStations(XMLEventReader reader, RailPublicTransitData railPublicTransit) throws XMLStreamException {
        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();
            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                if (startElement.getName().getLocalPart().equals(TAG_RAIL_STATION)) {
                    railPublicTransit.getRailStations().add(parseRailStation(reader, startElement));
                }
            }
            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_RAIL_STATIONS)) {
                return;
            }
        }
    }

    private RailStationData parseRailStation(XMLEventReader reader, StartElement railStationStartElement) throws XMLStreamException {
        RailStationData railStation = new RailStationData();

        parseRailStationAttributes(railStation, railStationStartElement);

        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();

            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                String tagName = startElement.getName().getLocalPart();

                switch (tagName) {
                    case TAG_EXIT:
                        railStation.getExits().add(parseExit(startElement));
                        break;
                    case TAG_TIMETABLE:
                        railStation.getTimetables().add(parseTimetable(startElement));
                        break;
                }
            }

            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_RAIL_STATION)) {
                return railStation;
            }
        }
        throw new XMLStreamException("Malformed XML: <railStation> tag not closed.");
    }

    private void parseRailStationAttributes(RailStationData railStation, StartElement element) {
        railStation.setId(getStringAttribute(element, "id"));
        railStation.setTransitMode(getStringAttribute(element, "transitMode"));
        railStation.setAddress(getStringAttribute(element, "address"));
        railStation.setCenter(getStringAttribute(element, "center"));

        String lineListStr = getStringAttribute(element, "lineList");
        if (lineListStr != null && !lineListStr.isEmpty()) {
            railStation.setLineList(Arrays.asList(lineListStr.split(" ")));
        } else {
            railStation.setLineList(Collections.emptyList());
        }
    }

    private ExitData parseExit(StartElement element) {
        return ExitData.builder()
                .id(getStringAttribute(element, "id"))
                .linkRef(getIntAttribute(element, "linkRef"))
                .offset(getIntAttribute(element, "offset"))
                .accessTime(getIntAttribute(element, "accessTime"))
                .coord(getStringAttribute(element, "coord"))
                .build();
    }

    private RailStationData.TimetableData parseTimetable(StartElement element) {
        RailStationData.TimetableData timetable = new RailStationData.TimetableData();
        timetable.setDayOfWeek(getStringAttribute(element, "dayOfWeek"));
        timetable.setLineId(getStringAttribute(element, "lineId"));

        String timeStr = getStringAttribute(element, "time");
        if (timeStr != null && !timeStr.isEmpty()) {
            timetable.setTimes(Arrays.asList(timeStr.split(" ")));
        } else {
            timetable.setTimes(Collections.emptyList());
        }
        return timetable;
    }
}