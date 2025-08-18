package com.iitp.iitp_rest.util;

import org.w3c.dom.Document;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class XmlUtils {

    public static InputStream loadXmlAsStream(String classpathLocation) {
        ClassLoader cl = Thread.currentThread().getContextClassLoader();
        if (cl == null) cl = XmlUtils.class.getClassLoader();
        InputStream is = cl.getResourceAsStream(classpathLocation);
        if (is == null) {
            throw new IllegalArgumentException("XML not found in classpath: " + classpathLocation);
        }
        return is;
    }

    public static InputStream openFileAsStream(Path path) {
        try {
            return Files.newInputStream(path, StandardOpenOption.READ);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to open file: " + path, e);
        }
    }

    public static Document parseStreamToDocument(InputStream is) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);
            doc.getDocumentElement().normalize();
            return doc;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse XML stream", e);
        }
    }

    public static Document parseStringToDocument(String xmlContent) {
        try (InputStream is = new ByteArrayInputStream(xmlContent.getBytes())) {
            return parseStreamToDocument(is);
        } catch (IOException e) {
            throw new RuntimeException("Failed to parse XML string", e);
        }
    }

}
