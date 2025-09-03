package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.geometry.Cartesian3;
import org.w3c.dom.Document;

import javax.xml.namespace.QName;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.stream.events.Attribute;
import javax.xml.stream.events.StartElement;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

    // "없음"으로 간주할 값들(대소문자 무시)
    private static final java.util.Set<String> NULLISH = Set.of("", "none", "null", "nan");

    // -------------------- String --------------------

    public static String getStringAttribute(StartElement element, String name) {
        Attribute attr = element.getAttributeByName(new QName(name));
        return attr != null ? attr.getValue() : null;
    }

    /** 공백/None/null/Nan 등을 null로 정규화 */
    public static String getStringAttributeOrNull(StartElement element, String name) {
        return normalize(getStringAttribute(element, name));
    }

    private static String normalize(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        if (v.isEmpty()) return null;
        String lower = v.toLowerCase(Locale.ROOT);
        if (NULLISH.contains(lower)) return null;
        return v;
    }

    // -------------------- int --------------------

    /** 문제가 있으면 0으로 반환 */
    public static int getIntAttribute(StartElement element, String name) {
        return getIntAttributeOrDefault(element, name, 0);
    }

    public static int getIntAttributeOrDefault(StartElement element, String name, int defaultValue) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return defaultValue;
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    /** 숫자가 아니면 null */
    public static Integer getIntAttributeOrNullStrict(StartElement element, String name) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return null;
        try {
            return Integer.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // -------------------- long --------------------

    /** 문제가 있으면 0L로 반환 */
    public static long getLongAttribute(StartElement element, String name) {
        return getLongAttributeOrDefault(element, name, 0L);
    }

    public static long getLongAttributeOrDefault(StartElement element, String name, long defaultValue) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return defaultValue;
        try {
            return Long.parseLong(v);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    /** 숫자가 아니면 null */
    public static Long getLongAttributeOrNullStrict(StartElement element, String name) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return null;
        try {
            return Long.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // -------------------- double --------------------

    /** 문제가 있으면 0.0으로 반환 */
    public static double getDoubleAttribute(StartElement element, String name) {
        return getDoubleAttributeOrDefault(element, name, 0.0);
    }

    public static double getDoubleAttributeOrDefault(StartElement element, String name, double defaultValue) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return defaultValue;
        try {
            return Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    /** 숫자가 아니면 null */
    public static Double getDoubleAttributeOrNullStrict(StartElement element, String name) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return null;
        try {
            return Double.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static Double parseDoubleOrNullStrict(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        if (v.isEmpty()) return null;
        String lower = v.toLowerCase(Locale.ROOT);
        // XmlUtils의 NULLISH 규약과 동일하게 취급
        if (NULLISH.contains(lower)) return null;
        try {
            return Double.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }


    // -------------------- boolean (옵션) --------------------
    public static boolean getBooleanAttributeOrDefault(StartElement element, String name, boolean defaultValue) {
        String v = normalize(getStringAttribute(element, name));
        if (v == null) return defaultValue;
        switch (v.toLowerCase(Locale.ROOT)) {
            case "true": case "t": case "1": case "yes": case "y": return true;
            case "false": case "f": case "0": case "no": case "n": return false;
            default: return defaultValue;
        }
    }

    // position string 변환
    public static List<Cartesian3> parseShapeToPositions(String shapeStr) {
        List<Cartesian3> positions = new ArrayList<>();
        if (shapeStr == null) return positions;

        String s = shapeStr.trim();
        if (s.isEmpty()) return positions;

        if (s.indexOf(',') >= 0) {
            String[] pairs = s.split("\\s+");
            for (String pair : pairs) {
                int c = pair.indexOf(',');
                if (c <= 0 || c >= pair.length() - 1) continue;

                Double x = parseDoubleOrNullStrict(pair.substring(0, c));
                Double y = parseDoubleOrNullStrict(pair.substring(c + 1));
                if (x == null || y == null) continue;

                positions.add(new Cartesian3(x, y, 0.0));
            }
            return positions;
        }

        String[] tokens = s.split("\\s+");
        for (int i = 0; i + 1 < tokens.length; i += 2) {
            Double x = parseDoubleOrNullStrict(tokens[i]);
            Double y = parseDoubleOrNullStrict(tokens[i + 1]);
            if (x == null || y == null) continue;

            positions.add(new Cartesian3(x, y, 0.0));
        }
        return positions;
    }

}
