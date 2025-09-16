package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.geometry.Polyline;
import com.iitp.iitp_rest.model.network.road.RoadResponse;
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
import java.util.List;

import static com.iitp.iitp_rest.util.XmlUtils.getStringAttribute;
import static com.iitp.iitp_rest.util.XmlUtils.parseDoubleOrNullStrict;

@Component
@RequiredArgsConstructor
public class RoadXmlParser implements XmlParser<RoadResponse> {

    private final XMLInputFactory xmlInputFactory;

    private static final String TAG_NETWORK = "Network";
    private static final String TAG_LINK = "link";
    private static final String TAG_LANE = "lane";

    private static final String ATTR_ID = "id";
    private static final String ATTR_SHAPE = "shape";

    @Override
    public RoadResponse parse(InputStream is) throws XMLStreamException {

        XMLEventReader eventReader = xmlInputFactory.createXMLEventReader(is);

        RoadResponse out = new RoadResponse();
        out.setRoads(new ArrayList<>());

        while (eventReader.hasNext()) {
            XMLEvent event = eventReader.nextEvent();

            if (event.isStartElement()) {
                StartElement start = event.asStartElement();
                String tag = start.getName().getLocalPart();

                if (TAG_LINK.equals(tag)) {
                    parseLinkAndEmitRoads(eventReader, start, out.getRoads());
                }
            }

            if (event.isEndElement()
                    && TAG_NETWORK.equals(event.asEndElement().getName().getLocalPart())) {
                break;
            }
        }
        return out;
    }

    /**
     * <link> 내부의 모든 <lane>에 대해 Road를 생성
     */
    private void parseLinkAndEmitRoads(XMLEventReader reader,
                                       StartElement linkStartElement,
                                       List<RoadResponse.Road> out) throws XMLStreamException {

        final String linkId = getStringAttribute(linkStartElement, ATTR_ID);

        while (reader.hasNext()) {
            XMLEvent event = reader.nextEvent();

            if (event.isStartElement()) {
                StartElement child = event.asStartElement();
                String tag = child.getName().getLocalPart();

                if (TAG_LANE.equals(tag)) {
                    RoadResponse.Road road = laneStartElementToRoad(linkId, child);

                    // </lane>까지 "인라인"으로 소비
                    while (reader.hasNext()) {
                        XMLEvent inner = reader.nextEvent();
                        if (inner.isEndElement()
                                && TAG_LANE.equals(inner.asEndElement().getName().getLocalPart())) {
                            break;
                        }
                    }

                    if (road != null) {
                        out.add(road);
                    }
                }
            }

            if (event.isEndElement()
                    && TAG_LINK.equals(event.asEndElement().getName().getLocalPart())) {
                return;
            }
        }

        throw new XMLStreamException("Malformed XML: <link> not closed.");
    }

    /**
     * 기존 DOM 파서 규칙과 동일:
     * - lane.shape를 공백 분리 → 각 토큰 "x,y"
     * - 첫 번째 점 → baseEasting/baseNorthing
     * - 두 번째 점 → targetEasting/targetNorthing
     */
    private RoadResponse.Road laneStartElementToRoad(String linkId, StartElement laneStartElement) {
        final String laneId = getStringAttribute(laneStartElement, ATTR_ID);
        final String shapeStr = getStringAttribute(laneStartElement, ATTR_SHAPE);

        if (shapeStr == null || shapeStr.trim().isEmpty()) return null;

        List<Cartesian3> positions = parseShapeToPositions(shapeStr);
        if (positions.isEmpty()) return null;

        Double baseEasting = null, baseNorthing = null, targetEasting = null, targetNorthing = null;

        Cartesian3 p0 = positions.getFirst();
        baseEasting = p0.getX();
        baseNorthing = p0.getY();
        if (positions.size() >= 2) {
            Cartesian3 p1 = positions.get(1);
            targetEasting = p1.getX();
            targetNorthing = p1.getY();
        }

        Polyline polyline = new Polyline(positions);
        return new RoadResponse.Road(linkId, laneId, polyline, baseEasting, baseNorthing, targetEasting, targetNorthing);
    }

    /**
     * "x,y x,y ..." → Cartesian3 목록 (숫자 파싱은 XmlUtils.parseDoubleOrNullStrict 사용)
     */
    private List<Cartesian3> parseShapeToPositions(String shapeStr) {
        List<Cartesian3> positions = new ArrayList<>();
        String trimmed = shapeStr.trim();
        if (trimmed.isEmpty()) return positions;

        String[] coords = trimmed.split("\\s+");
        for (String pair : coords) {
            String[] xy = pair.split(",");
            if (xy.length < 2) continue;

            Double x = parseDoubleOrNullStrict(xy[0]);
            Double y = parseDoubleOrNullStrict(xy[1]);
            if (x == null || y == null) continue;

            positions.add(new Cartesian3(x, y, 0.0));
        }
        return positions;
    }
}
