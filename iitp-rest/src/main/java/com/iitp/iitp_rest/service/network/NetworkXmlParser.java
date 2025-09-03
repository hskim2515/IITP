package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.*;
import com.iitp.iitp_rest.model.network.node.*;
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

import static com.iitp.iitp_rest.util.XmlUtils.*;

@Component
@RequiredArgsConstructor
public class NetworkXmlParser implements XmlParser<NetworkResponse> {

    private final XMLInputFactory xmlInputFactory;

    private static final String TAG_NETWORK = "Network";
    private static final String TAG_NODE = "node";
    private static final String TAG_PORT = "port";
    private static final String TAG_CONNECTION = "connection";
    private static final String TAG_LINK = "link";
    private static final String TAG_LANE = "lane";
    private static final String TAG_CELL = "cell";
    private static final String TAG_SEGMENT = "segment";

    @Override
    public NetworkResponse parse(InputStream is) throws XMLStreamException {
        XMLEventReader eventReader = xmlInputFactory.createXMLEventReader(is);
        NetworkResponse network = new NetworkResponse();
        network.setNodes(new ArrayList<>());
        network.setLinks(new ArrayList<>());

        while (eventReader.hasNext()) {
            XMLEvent event = eventReader.nextEvent();

            if (event.isStartElement()) {
                StartElement startElement = event.asStartElement();
                String tagName = startElement.getName().getLocalPart();

                switch (tagName) {
                    case TAG_NODE:
                        network.getNodes().add(parseNode(eventReader, startElement));
                        break;
                    case TAG_LINK:
                        network.getLinks().add(parseLink(eventReader, startElement));
                        break;
                }
            }

            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_NETWORK)) {
                break;
            }
        }
        return network;
    }

    private NodeResponse parseNode(XMLEventReader reader, StartElement nodeStartElement) throws XMLStreamException {
        NodeResponse node = new NodeResponse();
        parseNodeAttributes(node, nodeStartElement);

        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();

            if (event.isStartElement()) {
                StartElement childElement = event.asStartElement();
                String tagName = childElement.getName().getLocalPart();

                switch (tagName) {
                    case TAG_PORT:
                        PortResponse port = new PortResponse();
                        parsePortAttributes(port, childElement);
                        node.getPorts().add(port);
                        node.getPortLinkIds().add(port.getLinkId());
                        break;
                    case TAG_CONNECTION:
                        ConnectionResponse connection = new ConnectionResponse();
                        parseConnectionAttributes(connection, childElement);
                        node.getConnections().add(connection);
                        break;
                }
            }

            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_NODE)) {
                return node;
            }
        }
        throw new XMLStreamException("Malformed XML: <node> tag not closed.");
    }

    private LinkResponse parseLink(XMLEventReader reader, StartElement linkStartElement) throws XMLStreamException {
        LinkResponse link = new LinkResponse();
        parseLinkAttributes(link, linkStartElement);

        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();

            if (event.isStartElement()) {
                StartElement childElement = event.asStartElement();
                if (childElement.getName().getLocalPart().equals(TAG_LANE)) {
                    link.getLanes().add(parseLane(reader, childElement));
                }
            }

            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_LINK)) {
                return link;
            }
        }
        throw new XMLStreamException("Malformed XML: <link> tag not closed.");
    }

    private LaneResponse parseLane(XMLEventReader reader, StartElement laneStartElement) throws XMLStreamException {
        LaneResponse lane = new LaneResponse();
        parseLaneAttributes(lane, laneStartElement);

        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();

            if (event.isStartElement()) {
                StartElement childElement = event.asStartElement();
                String tagName = childElement.getName().getLocalPart();
                switch (tagName) {
                    case TAG_CELL:
                        CellResponse cell = new CellResponse();
                        parseCellAttributes(cell, childElement);
                        lane.getCells().add(cell);
                        break;
                    case TAG_SEGMENT:
                        SegmentResponse segment = new SegmentResponse();
                        parseSegmentAttributes(segment, childElement);
                        lane.getSegments().add(segment);
                        break;
                }
            }

            if (event.isEndElement() && event.asEndElement().getName().getLocalPart().equals(TAG_LANE)) {
                return lane;
            }
        }
        throw new XMLStreamException("Malformed XML: <lane> tag not closed.");
    }

    private void parseNodeAttributes(NodeResponse node, StartElement element) {
        node.setId(getLongAttribute(element, "id"));
        node.setType(NodeType.fromValue(getStringAttribute(element, "type")));
        node.setNumPort(getIntAttribute(element, "num_port"));
        node.setNumConnection(getIntAttribute(element, "num_connection"));
        node.setV2x(V2x.fromValue(getStringAttribute(element, "v2x")));
        node.setCenter(getStringAttribute(element, "center"));
    }

    private void parsePortAttributes(PortResponse port, StartElement element) {
        port.setType(PortType.fromValue(getStringAttribute(element, "type")));
        port.setLinkId(getStringAttribute(element, "link_id"));
        port.setDirection(getLongAttribute(element, "direction"));
    }

    private void parseConnectionAttributes(ConnectionResponse connection, StartElement element) {
        connection.setId(getLongAttribute(element, "id"));
        connection.setFromLink(getLongAttribute(element, "from_link"));
        connection.setFromLane(getLongAttribute(element, "from_lane"));
        connection.setToLink(getLongAttribute(element, "to_link"));
        connection.setToLane(getLongAttribute(element, "to_lane"));
        connection.setTurning(Turning.fromValue(getStringAttribute(element, "turning")));
        connection.setLength(getDoubleAttribute(element, "length"));
        connection.setWidth(getDoubleAttribute(element, "width"));
        connection.setFfSpd(getDoubleAttribute(element, "ff_spd"));
        connection.setShape(getStringAttribute(element, "shape"));
    }

    private void parseLinkAttributes(LinkResponse link, StartElement element) {
        link.setId(getLongAttribute(element, "id"));
        link.setFromNode(getLongAttribute(element, "from_node"));
        link.setToNode(getLongAttribute(element, "to_node"));
        link.setNumLane(getIntAttribute(element, "num_lane"));
        link.setLength(getDoubleAttribute(element, "length"));
        link.setWidth(getDoubleAttribute(element, "width"));
        link.setMinSpd(getDoubleAttribute(element, "min_spd"));
        link.setMaxSpd(getDoubleAttribute(element, "max_spd"));
        link.setFfSpd(getDoubleAttribute(element, "ff_spd"));
        link.setWaveSpd(getDoubleAttribute(element, "wave_spd"));
        link.setQmax(getDoubleAttribute(element, "qmax"));
        link.setMaxVeh(getDoubleAttribute(element, "max_veh"));
        link.setSimType(SimType.fromValue(getIntAttribute(element, "sim_type")));
        link.setType(LinkType.fromValue(getStringAttribute(element, "type")));
        link.setLayer(getStringAttribute(element, "layer"));
        link.setStopLine(getDoubleAttribute(element, "stop_line"));
        link.setShape(getStringAttribute(element, "shape"));
    }

    private void parseLaneAttributes(LaneResponse lane, StartElement element) {
        lane.setId(getLongAttribute(element, "id"));
        lane.setNumCell(getIntAttribute(element, "num_cell"));
        lane.setLeftLaneId(getStringAttribute(element, "left_lane_id"));
        lane.setRightLaneId(getStringAttribute(element, "right_lane_id"));
        lane.setShape(getStringAttribute(element, "shape"));
    }

    private void parseCellAttributes(CellResponse cell, StartElement element) {
        cell.setId(getLongAttribute(element, "id"));
        cell.setLength(getDoubleAttribute(element, "length"));
        cell.setOffset(getDoubleAttribute(element, "offset"));
    }

    private void parseSegmentAttributes(SegmentResponse segment, StartElement element) {
        segment.setId(getLongAttribute(element, "id"));
        segment.setBlock(getBooleanAttributeOrDefault(element, "block", false));
        segment.setInitPoint(getDoubleAttribute(element, "init_point"));
        segment.setEndPoint(getDoubleAttribute(element, "end_point"));
    }
}