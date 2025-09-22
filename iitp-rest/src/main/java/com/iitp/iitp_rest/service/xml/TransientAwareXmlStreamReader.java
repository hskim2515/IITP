package com.iitp.iitp_rest.service.xml;

import jakarta.xml.bind.annotation.XmlTransient;
import lombok.extern.slf4j.Slf4j;

import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.stream.util.StreamReaderDelegate;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
public class TransientAwareXmlStreamReader extends StreamReaderDelegate {

    /** 클래스명 → (소문자 필드명 → true) */
    private static final Map<String, Map<String, Boolean>> CLASS_TRANSIENT_CACHE = new ConcurrentHashMap<>();

    /** 도메인 모델 루트 패키지 (필요 시 조정) */
    private static final String DOMAIN_ROOT_PACKAGE = "com.iitp.iitp_rest.model";

    /** JDK 패키지 프리픽스(스캔 제외) */
    private static final String[] JDK_PREFIXES = new String[]{
            "java.", "javax.", "jakarta.", "sun.", "com.sun.", "jdk."
    };

    private final Map<String, Boolean> transientFieldCache;
    private final Class<?> targetClass;

    public TransientAwareXmlStreamReader(XMLStreamReader reader, Class<?> targetClass) {
        super(reader);
        this.targetClass = targetClass;
        this.transientFieldCache = getOrCreateTransientFieldCache(targetClass);
    }

    private Map<String, Boolean> getOrCreateTransientFieldCache(Class<?> clazz) {
        if (clazz == null) return new ConcurrentHashMap<>();
        final String className = clazz.getName();

        // computeIfAbsent 본문에서 캐시를 구성.
        return CLASS_TRANSIENT_CACHE.computeIfAbsent(className, k -> {
            Map<String, Boolean> cache = new ConcurrentHashMap<>();
            // 순환 방지용 visited
            Set<Class<?>> visited = Collections.newSetFromMap(new IdentityHashMap<>());
            try {
                cacheTransientFields(clazz, cache, visited, 0);
            } catch (Throwable t) {
                log.warn("Failed to build @XmlTransient cache for class: {}", className, t);
            }
            return cache;
        });
    }

    /**
     * @param clazz   현재 스캔 대상 클래스
     * @param cache   (소문자 필드명 → true)
     * @param visited 순환 방지
     * @param depth   (옵션) 최대 깊이 제한에 사용
     */
    private void cacheTransientFields(Class<?> clazz,
                                      Map<String, Boolean> cache,
                                      Set<Class<?>> visited,
                                      int depth) {
        if (clazz == null || clazz == Object.class) return;
        if (!isDomainType(clazz)) return;

        final int MAX_DEPTH = 128;
        if (depth > MAX_DEPTH) {
            log.debug("Max scan depth reached at {}", clazz.getName());
            return;
        }

        if (!visited.add(clazz)) {
            return;
        }

        for (Field field : safeGetDeclaredFields(clazz)) {
            if (shouldSkipField(field)) continue;

            if (field.isAnnotationPresent(XmlTransient.class)) {
                String name = field.getName();
                putNameAndPluralForms(cache, name);
                log.debug("Cached @XmlTransient field: {} from {}", name, clazz.getSimpleName());
            }

            addTypeRecursively(field.getGenericType(), cache, visited, depth + 1);
        }

        for (Class<?> inner : safeGetDeclaredClasses(clazz)) {
            if (isDomainType(inner)) {
                cacheTransientFields(inner, cache, visited, depth + 1);
            }
        }

        cacheTransientFields(clazz.getSuperclass(), cache, visited, depth + 1);
    }

    private void addTypeRecursively(Type type,
                                    Map<String, Boolean> cache,
                                    Set<Class<?>> visited,
                                    int depth) {
        if (type == null) return;

        if (type instanceof Class<?> cls) {
            if (isDomainType(cls)) {
                cacheTransientFields(cls, cache, visited, depth);
            }
            return;
        }

        if (type instanceof ParameterizedType p) {
            addTypeRecursively(p.getRawType(), cache, visited, depth);
            for (Type arg : p.getActualTypeArguments()) {
                addTypeRecursively(arg, cache, visited, depth);
            }
            return;
        }

        if (type instanceof GenericArrayType ga) {
            addTypeRecursively(ga.getGenericComponentType(), cache, visited, depth);
            return;
        }

        if (type instanceof TypeVariable<?> tv) {
            for (Type bound : tv.getBounds()) {
                addTypeRecursively(bound, cache, visited, depth);
            }
            return;
        }

        if (type instanceof WildcardType wt) {
            for (Type upper : wt.getUpperBounds()) addTypeRecursively(upper, cache, visited, depth);
            for (Type lower : wt.getLowerBounds()) addTypeRecursively(lower, cache, visited, depth);
        }
    }

    private static boolean isDomainType(Class<?> cls) {
        if (cls.isPrimitive() || cls.isEnum()) return false;
        if (cls.isArray()) return false;

        final Package pkg = cls.getPackage();
        final String pn = (pkg != null ? pkg.getName() : "");
        if (pn.isEmpty()) return false;

        for (String jdk : JDK_PREFIXES) {
            if (pn.startsWith(jdk)) return false;
        }
        return pn.startsWith(DOMAIN_ROOT_PACKAGE);
    }

    private static boolean shouldSkipField(Field f) {
        int mod = f.getModifiers();
        if (Modifier.isStatic(mod)) return true;
        if (f.isSynthetic()) return true;
        try {
            if (f.getDeclaringClass().isRecord()) return true;
        } catch (Throwable ignore) { }
        return false;
    }

    private static Field[] safeGetDeclaredFields(Class<?> cls) {
        try {
            return cls.getDeclaredFields();
        } catch (Throwable t) {
            return new Field[0];
        }
    }

    private static Class<?>[] safeGetDeclaredClasses(Class<?> cls) {
        try {
            return cls.getDeclaredClasses();
        } catch (Throwable t) {
            return new Class<?>[0];
        }
    }

    private static void putNameAndPluralForms(Map<String, Boolean> cache, String fieldName) {
        if (fieldName == null || fieldName.isEmpty()) return;
        String key = fieldName.toLowerCase(Locale.ROOT);
        cache.put(key, true);
        if (!key.endsWith("s")) cache.put(key + "s", true);
        else cache.put(key.substring(0, key.length() - 1), true);
    }

    @Override
    public int next() throws XMLStreamException {
        int event = super.next();

        if (event == START_ELEMENT) {
            String elementName = getLocalName();
            if (elementName != null && isTransientField(elementName)) {
                log.debug("Skipping @XmlTransient element: {}", elementName);
                return skipTransientElement();
            }
        }
        return event;
    }

    private int skipTransientElement() throws XMLStreamException {
        int depth = 1;
        while (depth > 0 && hasNext()) {
            int event = super.next();
            if (event == START_ELEMENT) depth++;
            else if (event == END_ELEMENT) depth--;
        }
        return hasNext() ? super.next() : END_DOCUMENT;
    }

    public boolean isTransientField(String fieldName) {
        if (fieldName == null) return false;
        return transientFieldCache.containsKey(fieldName.toLowerCase(Locale.ROOT));
    }
}
