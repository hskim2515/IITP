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
            return name != null ? name.getLocalPart() : null;
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
        switch (event) {
            case START_ELEMENT:
                this.lastElementName = getCurrentElementName();
                int attributeCount = this.getAttributeCount();
                if (attributeCount > 0) {
                    this.lastAttributeName = this.getAttributeLocalName(attributeCount - 1);
                } else {
                    this.lastAttributeName = null;
                }
                break;
            case END_ELEMENT:
                this.lastElementName = getCurrentElementName();
                this.lastAttributeName = null;
                break;
            default:
                // no-op
        }
    }
}
