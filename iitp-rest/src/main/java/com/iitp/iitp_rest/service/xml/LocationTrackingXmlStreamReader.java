package com.iitp.iitp_rest.service.xml;

import lombok.Getter;

import javax.xml.namespace.QName;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.stream.util.StreamReaderDelegate;

@Getter
public class LocationTrackingXmlStreamReader extends StreamReaderDelegate {

    private String lastElementName;
    private String lastAttributeName;

    public LocationTrackingXmlStreamReader(XMLStreamReader reader) {
        super(reader);
    }

    private String getCurrentElementName() {
        if (this.isStartElement() || this.isEndElement()) {
            QName name = this.getName();
            return name.getLocalPart();
        }
        return null;
    }

    @Override
    public int next() throws XMLStreamException {
        int event = super.next();
        trackLocation(event);
        return event;
    }

    @Override
    public int nextTag() throws XMLStreamException {
        int event = super.nextTag();
        trackLocation(event);
        return event;
    }

    private void trackLocation(int event) {
        if (event == START_ELEMENT) {
            this.lastElementName = getCurrentElementName();
            int attributeCount = this.getAttributeCount();
            if (attributeCount > 0) {
                for (int i = 0; i < attributeCount; i++) {
                    this.lastAttributeName = this.getAttributeLocalName(i);
                }
            }
        }
    }
}