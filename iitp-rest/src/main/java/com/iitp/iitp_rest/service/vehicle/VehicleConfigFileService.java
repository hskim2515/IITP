package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 차량 유형과 표시 모델을 시나리오 버전 폴더의 XML/GLB로 관리한다.
 *
 * <p>현재 저장 구현은 파일 기반이지만 컨트롤러는 이 서비스의 DTO만 사용한다. 향후 JSONB 기반
 * 저장소로 바꿀 때도 프런트 API 계약과 NextSim XML 형식은 그대로 유지할 수 있다.
 */
@Service
@RequiredArgsConstructor
public class VehicleConfigFileService {

    private static final String VEHICLE_TYPES_FILE = "vehicletypes.xml";
    private static final String VISUALIZATION_DIR = "visualization";
    private static final String MODELS_DIR = VISUALIZATION_DIR + "/models";
    private static final String MODELS_MANIFEST = VISUALIZATION_DIR + "/vehicleModels.xml";
    private static final List<String> PARAMETER_NAMES = List.of(
            "veh_len", "veh_width", "jamgap", "vf", "reaction_time",
            "max_acc", "max_dec", "lc_param1", "lc_param2", "lc_sensitivity");
    private static final List<String> CANONICAL_NAMES = List.of(
            "NormalVeh", "AutonomousVeh", "Truck", "NormalBus", "AutonomousBus", "TRT");
    private static final Map<String, String> TYPE_CODES = Map.of(
            "NormalVeh", "NV",
            "AutonomousVeh", "AV",
            "Truck", "TRUCK",
            "NormalBus", "NB",
            "AutonomousBus", "AB",
            "TRT", "TRT");
    private static final Map<String, String> DISPLAY_NAMES = Map.of(
            "NormalVeh", "일반 차량",
            "AutonomousVeh", "자율주행 차량",
            "Truck", "트럭",
            "NormalBus", "일반 버스",
            "AutonomousBus", "자율주행 버스",
            "TRT", "TRT");

    private final FileStorageService fileStorage;

    public record ParameterData(String mean, String sd, String min, String max, String dist) {}

    public record VehicleTypeData(
            Long id,
            String key,
            String vehicleId,
            String name,
            String canonicalName,
            String v2x,
            String drt,
            String maxPax,
            String nextsimTypeCode,
            boolean platformOnly,
            Map<String, ParameterData> parameters) {}

    public record VehicleModelData(
            Long id,
            String key,
            String name,
            String color,
            String length,
            String fileName,
            String filePath,
            Long vehicleTypeId,
            String vehicleTypeKey,
            String correctionHpr,
            Double zOffset) {}

    public record VehicleConfiguration(
            List<VehicleTypeData> vehicleTypes,
            List<VehicleModelData> vehicleModels) {}

    public record SaveRequest(
            String key,
            VehicleTypeData vehicleType,
            VehicleModelData model,
            boolean removeFile) {}

    public VehicleConfiguration load(String versionId) throws Exception {
        validateVersionId(versionId);
        Document manifest = loadManifest(versionId);
        Map<String, Element> modelElements = modelElementsByKey(manifest);

        Document vehicleTypes = loadVehicleTypesDocument(versionId);
        List<VehicleTypeData> types = new ArrayList<>();
        List<VehicleModelData> models = new ArrayList<>();

        NodeList typeNodes = vehicleTypes.getDocumentElement().getElementsByTagName("vehtype");
        for (int index = 0; index < typeNodes.getLength(); index++) {
            Element element = (Element) typeNodes.item(index);
            String canonical = element.getAttribute("name");
            int canonicalIndex = CANONICAL_NAMES.indexOf(canonical);
            if (canonicalIndex < 0) continue;
            long id = canonicalIndex + 1L;
            Element modelElement = modelElements.remove(canonical);
            String displayName = attr(modelElement, "displayName", DISPLAY_NAMES.get(canonical));
            String code = TYPE_CODES.get(canonical);
            types.add(new VehicleTypeData(
                    id,
                    canonical,
                    code,
                    displayName,
                    canonical,
                    attr(element, "v2x", "off"),
                    "0",
                    attr(element, "max_pax", "0"),
                    code,
                    false,
                    readParameters(element)));
            if (modelElement != null) models.add(toModel(versionId, id, canonical, modelElement));
        }

        long platformId = 1000L;
        for (Map.Entry<String, Element> entry : modelElements.entrySet()) {
            Element element = entry.getValue();
            if (!Boolean.parseBoolean(attr(element, "platformOnly", "false"))) continue;
            long id = platformId++;
            String key = entry.getKey();
            String vehicleId = attr(element, "vehicleId", key);
            String displayName = attr(element, "displayName", vehicleId);
            types.add(new VehicleTypeData(
                    id, key, vehicleId, displayName, null, "off", "0", "0", "",
                    true, Map.of()));
            models.add(toModel(versionId, id, key, element));
        }
        return new VehicleConfiguration(types, models);
    }

    public VehicleConfiguration save(
            String versionId,
            SaveRequest request,
            MultipartFile file) throws Exception {
        validateVersionId(versionId);
        if (request == null || request.vehicleType() == null) {
            throw new IllegalArgumentException("차량 유형 데이터가 없습니다.");
        }
        VehicleTypeData type = request.vehicleType();
        String key = safeKey(type.platformOnly() ? firstNonBlank(type.vehicleId(), request.key()) : type.canonicalName());
        if (!type.platformOnly() && !CANONICAL_NAMES.contains(key)) {
            throw new IllegalArgumentException("지원하지 않는 NextSim 차량 유형입니다: " + key);
        }

        if (!type.platformOnly()) {
            Document document = loadVehicleTypesDocument(versionId);
            Element target = findVehicleType(document, key);
            if (target == null) throw new IllegalArgumentException("차량 유형을 찾을 수 없습니다: " + key);
            target.setAttribute("name", key);
            target.setAttribute("v2x", firstNonBlank(type.v2x(), "off"));
            target.setAttribute("max_pax", firstNonBlank(type.maxPax(), "0"));
            writeParameters(document, target, type.parameters());
            writeDocument(versionId, VEHICLE_TYPES_FILE, document);
        }

        Document manifest = loadManifest(versionId);
        Element modelElement = modelElementsByKey(manifest).get(key);
        if (modelElement == null) {
            modelElement = manifest.createElement("VehicleModel");
            modelElement.setAttribute("key", key);
            manifest.getDocumentElement().appendChild(modelElement);
        }
        modelElement.setAttribute("vehicleId", firstNonBlank(type.vehicleId(), key));
        modelElement.setAttribute("displayName", firstNonBlank(type.name(), key));
        modelElement.setAttribute("platformOnly", Boolean.toString(type.platformOnly()));

        VehicleModelData model = request.model();
        if (model != null) {
            setAttr(modelElement, "modelName", model.name());
            setAttr(modelElement, "color", model.color());
            setAttr(modelElement, "length", model.length());
            setAttr(modelElement, "correctionHpr", model.correctionHpr());
            setAttr(modelElement, "zOffset", model.zOffset() == null ? null : model.zOffset().toString());
        }

        String oldFileName = modelElement.getAttribute("fileName");
        if (request.removeFile() && !oldFileName.isBlank()) {
            fileStorage.deleteFile(versionId + "/" + MODELS_DIR + "/" + oldFileName);
            modelElement.removeAttribute("fileName");
        }
        if (file != null && !file.isEmpty()) {
            if (!oldFileName.isBlank()) {
                fileStorage.deleteFile(versionId + "/" + MODELS_DIR + "/" + oldFileName);
            }
            String savedName = safeFileName(key + "_" + Objects.requireNonNullElse(file.getOriginalFilename(), "model.glb"));
            fileStorage.uploadFile(file.getInputStream(), versionId + "/" + MODELS_DIR, savedName);
            modelElement.setAttribute("fileName", savedName);
        }
        writeDocument(versionId, MODELS_MANIFEST, manifest);
        return load(versionId);
    }

    public byte[] readModel(String versionId, String fileName) throws IOException {
        validateVersionId(versionId);
        String safeName = safeFileName(fileName);
        if (!safeName.equals(fileName)) throw new IllegalArgumentException("잘못된 모델 파일명입니다.");
        return fileStorage.readFile(versionId + "/" + MODELS_DIR + "/" + safeName);
    }

    public void cloneFiles(String sourceVersionId, String destinationVersionId) throws Exception {
        validateVersionId(sourceVersionId);
        validateVersionId(destinationVersionId);
        copyIfPresent(sourceVersionId, destinationVersionId, VEHICLE_TYPES_FILE);
        copyIfPresent(sourceVersionId, destinationVersionId, MODELS_MANIFEST);
        if (!fileStorage.exists(sourceVersionId + "/" + MODELS_MANIFEST)) return;
        Document manifest = parse(fileStorage.readFile(sourceVersionId + "/" + MODELS_MANIFEST));
        for (Element element : modelElementsByKey(manifest).values()) {
            String fileName = element.getAttribute("fileName");
            if (fileName.isBlank()) continue;
            String source = sourceVersionId + "/" + MODELS_DIR + "/" + fileName;
            if (!fileStorage.exists(source)) continue;
            fileStorage.uploadFile(
                    new ByteArrayInputStream(fileStorage.readFile(source)),
                    destinationVersionId + "/" + MODELS_DIR,
                    fileName);
        }
    }

    private void copyIfPresent(String source, String destination, String relativePath) throws IOException {
        String sourcePath = source + "/" + relativePath;
        if (!fileStorage.exists(sourcePath)) return;
        int slash = relativePath.lastIndexOf('/');
        String subDirectory = slash < 0 ? destination : destination + "/" + relativePath.substring(0, slash);
        String fileName = slash < 0 ? relativePath : relativePath.substring(slash + 1);
        fileStorage.uploadFile(new ByteArrayInputStream(fileStorage.readFile(sourcePath)), subDirectory, fileName);
    }

    private Document loadVehicleTypesDocument(String versionId) throws Exception {
        String path = versionId + "/" + VEHICLE_TYPES_FILE;
        if (fileStorage.exists(path)) return parse(fileStorage.readFile(path));
        ClassPathResource defaults = new ClassPathResource("nextsim/default-vehicletypes.xml.template");
        try (InputStream input = defaults.getInputStream()) {
            return parse(input.readAllBytes());
        }
    }

    private Document loadManifest(String versionId) throws Exception {
        String path = versionId + "/" + MODELS_MANIFEST;
        if (fileStorage.exists(path)) return parse(fileStorage.readFile(path));
        Document document = newDocument();
        document.appendChild(document.createElement("VehicleModels"));
        return document;
    }

    private Map<String, Element> modelElementsByKey(Document document) {
        Map<String, Element> result = new LinkedHashMap<>();
        NodeList nodes = document.getDocumentElement().getElementsByTagName("VehicleModel");
        for (int index = 0; index < nodes.getLength(); index++) {
            Element element = (Element) nodes.item(index);
            String key = element.getAttribute("key");
            if (!key.isBlank()) result.put(key, element);
        }
        return result;
    }

    private VehicleModelData toModel(String versionId, long typeId, String key, Element element) {
        String fileName = blankToNull(element.getAttribute("fileName"));
        String filePath = fileName == null
                ? null
                : "/vehicle-config/" + versionId + "/models/" + fileName;
        return new VehicleModelData(
                typeId,
                key,
                attr(element, "modelName", attr(element, "displayName", key) + " 기본 모델"),
                attr(element, "color", "#4f8cff"),
                attr(element, "length", ""),
                fileName,
                filePath,
                typeId,
                key,
                attr(element, "correctionHpr", "{\"heading\":0,\"pitch\":0,\"roll\":3.141592653589793}"),
                parseDouble(attr(element, "zOffset", "0.2"), 0.2));
    }

    private Map<String, ParameterData> readParameters(Element vehicleType) {
        Map<String, ParameterData> parameters = new LinkedHashMap<>();
        for (String name : PARAMETER_NAMES) {
            NodeList nodes = vehicleType.getElementsByTagName(name);
            if (nodes.getLength() == 0) continue;
            Element element = (Element) nodes.item(0);
            parameters.put(name, new ParameterData(
                    element.getAttribute("mean"),
                    element.getAttribute("sd"),
                    element.getAttribute("min"),
                    element.getAttribute("max"),
                    normalizeDistribution(element.getAttribute("dist"))));
        }
        return parameters;
    }

    private void writeParameters(
            Document document,
            Element vehicleType,
            Map<String, ParameterData> parameters) {
        if (parameters == null) return;
        for (String name : PARAMETER_NAMES) {
            ParameterData data = parameters.get(name);
            if (data == null) continue;
            Element element = firstChild(vehicleType, name);
            if (element == null) {
                element = document.createElement(name);
                vehicleType.appendChild(element);
            }
            element.setAttribute("mean", data.mean());
            element.setAttribute("sd", data.sd());
            element.setAttribute("min", data.min());
            element.setAttribute("max", data.max());
            element.setAttribute("dist", xmlDistribution(data.dist()));
        }
    }

    private Element findVehicleType(Document document, String canonicalName) {
        NodeList nodes = document.getDocumentElement().getElementsByTagName("vehtype");
        for (int index = 0; index < nodes.getLength(); index++) {
            Element element = (Element) nodes.item(index);
            if (canonicalName.equals(element.getAttribute("name"))) return element;
        }
        return null;
    }

    private Element firstChild(Element parent, String name) {
        NodeList children = parent.getChildNodes();
        for (int index = 0; index < children.getLength(); index++) {
            Node child = children.item(index);
            if (child instanceof Element element && name.equals(element.getTagName())) return element;
        }
        return null;
    }

    private void writeDocument(String versionId, String relativePath, Document document) throws Exception {
        byte[] bytes = serialize(document);
        int slash = relativePath.lastIndexOf('/');
        String subDirectory = slash < 0 ? versionId : versionId + "/" + relativePath.substring(0, slash);
        String fileName = slash < 0 ? relativePath : relativePath.substring(slash + 1);
        fileStorage.uploadFile(new ByteArrayInputStream(bytes), subDirectory, fileName);
    }

    private Document parse(byte[] bytes) throws Exception {
        return documentBuilderFactory().newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
    }

    private Document newDocument() throws Exception {
        return documentBuilderFactory().newDocumentBuilder().newDocument();
    }

    private DocumentBuilderFactory documentBuilderFactory() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return factory;
    }

    private byte[] serialize(Document document) throws Exception {
        removeWhitespaceNodes(document.getDocumentElement());
        TransformerFactory factory = TransformerFactory.newInstance();
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
        var transformer = factory.newTransformer();
        transformer.setOutputProperty(OutputKeys.ENCODING, StandardCharsets.UTF_8.name());
        transformer.setOutputProperty(OutputKeys.INDENT, "yes");
        transformer.setOutputProperty("{http://xml.apache.org/xslt}indent-amount", "4");
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            transformer.transform(new DOMSource(document), new StreamResult(output));
            return output.toByteArray();
        }
    }

    private void removeWhitespaceNodes(Node node) {
        Node child = node.getFirstChild();
        while (child != null) {
            Node next = child.getNextSibling();
            if (child.getNodeType() == Node.TEXT_NODE && child.getTextContent().isBlank()) {
                node.removeChild(child);
            } else {
                removeWhitespaceNodes(child);
            }
            child = next;
        }
    }

    private static String attr(Element element, String name, String fallback) {
        if (element == null) return fallback;
        String value = element.getAttribute(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static void setAttr(Element element, String name, String value) {
        if (value == null || value.isBlank()) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }

    private static String firstNonBlank(String first, String fallback) {
        return first == null || first.isBlank() ? fallback : first;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String normalizeDistribution(String value) {
        return "lognormal".equalsIgnoreCase(value) ? "lognormal" : "normal";
    }

    private static String xmlDistribution(String value) {
        return "lognormal".equalsIgnoreCase(value) ? "LogNormal" : "Normal";
    }

    private static Double parseDouble(String value, double fallback) {
        try {
            return Double.parseDouble(value);
        } catch (RuntimeException exception) {
            return fallback;
        }
    }

    private static void validateVersionId(String versionId) {
        if (versionId == null || !versionId.matches("[A-Za-z0-9._-]+")) {
            throw new IllegalArgumentException("잘못된 시나리오 버전 키입니다.");
        }
    }

    private static String safeKey(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._-]+")) {
            throw new IllegalArgumentException("차량 유형 키에는 영문, 숫자, ., _, -만 사용할 수 있습니다.");
        }
        return value;
    }

    private static String safeFileName(String value) {
        if (value == null) return "";
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }
}
