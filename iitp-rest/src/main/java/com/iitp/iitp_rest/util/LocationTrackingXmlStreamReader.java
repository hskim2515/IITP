package com.iitp.iitp_rest.util;

import javax.xml.namespace.QName;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.stream.util.StreamReaderDelegate;

public class LocationTrackingXmlStreamReader extends StreamReaderDelegate {

    private String lastElementName;
    private String lastAttributeName;

    public LocationTrackingXmlStreamReader(XMLStreamReader reader) {
        super(reader);
    }

    // 외부에서 마지막 위치를 가져갈 수 있는 getter
    public String getLastElementName() {
        return lastElementName;
    }

    public String getLastAttributeName() {
        return lastAttributeName;
    }

    // 현재 요소의 이름을 가져오는 헬퍼 메서드
    private String getCurrentElementName() {
        if (this.isStartElement() || this.isEndElement()) {
            QName name = this.getName();
            return name.getLocalPart();
        }
        return null;
    }

    // JAXB가 XML 스트림을 읽을 때마다 이 메서드들이 호출됩니다.
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
            // 속성이 여러 개일 수 있으므로, 각 속성의 이름을 추적
            int attributeCount = this.getAttributeCount();
            if (attributeCount > 0) {
                // 단순화를 위해 마지막 속성만 추적하거나, 리스트로 모두 저장할 수 있습니다.
                // 여기서는 예외 발생 시 가장 가까운 속성을 알기 위해 순회합니다.
                for (int i = 0; i < attributeCount; i++) {
                    this.lastAttributeName = this.getAttributeLocalName(i);
                }
            }
        }
    }
}