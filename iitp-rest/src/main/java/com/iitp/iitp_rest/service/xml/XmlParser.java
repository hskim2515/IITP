package com.iitp.iitp_rest.service.xml;

import javax.xml.stream.XMLStreamException;
import java.io.InputStream;

public interface XmlParser<T> {

    T parse(InputStream inputStream) throws XMLStreamException;
}