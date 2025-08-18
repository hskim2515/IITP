package com.iitp.iitp_rest.service.xml;

import javax.xml.stream.XMLEventReader;
import javax.xml.stream.XMLStreamException;
import java.util.List;

public interface XmlParser<T> {

    boolean supports(String rootTagName);

    T parse(XMLEventReader eventReader) throws XMLStreamException;
}
