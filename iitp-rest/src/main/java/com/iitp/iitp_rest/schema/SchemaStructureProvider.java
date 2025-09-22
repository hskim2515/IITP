package com.iitp.iitp_rest.schema;

import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlTransient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.lang.reflect.Field;
import java.lang.reflect.ParameterizedType;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class SchemaStructureProvider {

    private final Map<String, Map<String, List<String>>> structureMapCache = new ConcurrentHashMap<>();
    private final Map<String, List<String>> rootsCache = new ConcurrentHashMap<>();

    public SchemaStructureProvider(List<SchemaStructureRegistration> registrations) {
        log.info("Initializing SchemaStructureProvider with {} registration(s)...", registrations.size());
        registrations.forEach(this::scanAndCacheStructure);
        log.info("Schema structure scan complete.");
    }

    private void scanAndCacheStructure(SchemaStructureRegistration registration) {
        String layerName = registration.getName();
        Class<?> entryPointClass = registration.getScanEntryPointClass();
        List<String> rootSchemaNames = registration.getRootSchemaNames();

        Map<String, List<String>> structureMap = new HashMap<>();
        scanRecursively(entryPointClass, structureMap, new HashMap<>());

        rootsCache.put(layerName.toLowerCase(), rootSchemaNames);
        structureMapCache.put(layerName.toLowerCase(), structureMap);
        log.info("Layer '{}' scanned. EntryPoint: {}, Roots: {}, Structure: {}",
                layerName, entryPointClass.getSimpleName(), rootSchemaNames, structureMap);
    }

    private void scanRecursively(Class<?> parentClass, Map<String, List<String>> structureMap, Map<String, Boolean> visited) {
        String parentSchemaName = getSchemaName(parentClass);
        if (visited.containsKey(parentSchemaName)) {
            return;
        }
        visited.put(parentSchemaName, true);

        List<String> children = new ArrayList<>();
        for (Field field : parentClass.getDeclaredFields()) {

            // @XmlTransient 어노테이션이 있는 필드 제외
            if (field.isAnnotationPresent(XmlTransient.class)) {
                continue;
            }

            if (field.isAnnotationPresent(XmlElement.class)) {
                Class<?> childClass = null;

                // Case 1: 필드가 List 타입인 경우
                if (List.class.isAssignableFrom(field.getType())) {
                    childClass = getGenericTypeOfList(field);
                }
                // ✅ Case 2: 필드가 List가 아닌 단일 객체이고, @XmlAccessorType 어노테이션이 붙어있는 경우
                else if (field.getType().isAnnotationPresent(XmlAccessorType.class)) {
                    childClass = field.getType();
                }

                if (childClass != null) {
                    String childSchemaName = getSchemaName(childClass);
                    children.add(childSchemaName);
                    scanRecursively(childClass, structureMap, visited);
                }
            }
        }

        if (!children.isEmpty()) {
            structureMap.put(parentSchemaName, children);
        }
    }

    private String getSchemaName(Class<?> clazz) {
        String nameWithoutXml = clazz.getSimpleName().replace("Xml", "");

        if (nameWithoutXml.isEmpty() || Character.isLowerCase(nameWithoutXml.charAt(0))) {
            // No change needed
        } else {
            nameWithoutXml = Character.toLowerCase(nameWithoutXml.charAt(0)) + nameWithoutXml.substring(1);
        }

        return nameWithoutXml.endsWith("s") ? nameWithoutXml : nameWithoutXml + "s";
    }

    private Class<?> getGenericTypeOfList(Field field) {
        try {
            ParameterizedType listType = (ParameterizedType) field.getGenericType();
            return (Class<?>) listType.getActualTypeArguments()[0];
        } catch (Exception e) {
            log.error("Failed to get generic type for field {} in class {}", field.getName(), field.getDeclaringClass().getSimpleName(), e);
            return null;
        }
    }

    public Map<String, List<String>> getStructureMap(String layerName) {
        return structureMapCache.getOrDefault(layerName.toLowerCase(), Map.of());
    }

    public List<String> getRootSchemaNames(String layerName) {
        return rootsCache.getOrDefault(layerName.toLowerCase(), List.of());
    }
}