import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSchemaStore } from "@stores/useSchemaStore";
import { useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClose } from "@fortawesome/free-solid-svg-icons/faClose";
import { faMinus } from "@fortawesome/free-solid-svg-icons";
import { useWorkflowStore } from "@stores/useWorkflowStore";
import { SchemaTable } from "@component/schema/SchemaTable";
import debounce from "lodash.debounce";
import { LayerSchemaResponse, SchemaDefinition } from "@type/openapi.gen";
import styles from "@css/SchemaSetting.module.css"

const SchemaSetting = () => {

    const { activeSubmenu, setActiveSubmenu } = useMenuStore();

    const getSchemaByLayerName = useSchemaStore((state) => state.getLayerSchemaByLayerName);
    const setCurrentSchema = useSchemaStore((state) => state.setCurrentSchema);
    const updateSchema = useSchemaStore((state) => state.updateSchema);

    const menuCode = activeSubmenu?.menuCode ?? null;
    const item = menuCode ? propertyFormSchema[menuCode] : null;
    const layerName = item?.layer ?? null;

    const initialLayerSchema = useMemo(() => {
        if (!layerName) return null;
        const schema = getSchemaByLayerName(layerName);
        return schema ? structuredClone(schema) : null;
    }, [getSchemaByLayerName, layerName]);

    const [layerSchema, setLayerSchema] = useState<LayerSchemaResponse | null>(initialLayerSchema);

    useEffect(() => {
        setLayerSchema(initialLayerSchema);
    }, [initialLayerSchema]);

    const debouncedSetUpdated = useMemo(
        () =>
            debounce((nextLayer: LayerSchemaResponse) => {
                if (layerName) setCurrentSchema(layerName, nextLayer);
            }, 300),
        [setCurrentSchema, layerName]
    );

    const handleSetSchema = useCallback(
        (updatedSchema: SchemaDefinition) => {
            if (!layerName) return;
            setLayerSchema((prev) => {
                if (!prev) return prev;
                const next: LayerSchemaResponse = {
                    ...prev,
                    definition: (prev.definition ?? []).map((s) =>
                        s.id === updatedSchema.id ? updatedSchema : s
                    ),
                };
                setCurrentSchema(layerName, next);
                return next;
            });
        },
        [debouncedSetUpdated, setCurrentSchema, layerName]
    );

    const handleSaveAll = useCallback(async () => {
        if (!layerSchema || !layerName) return;
        setCurrentSchema(layerName, layerSchema);
        await updateSchema(layerName);
    }, [layerSchema, layerName, updateSchema, setCurrentSchema]);

    const minimizeSession = useWorkflowStore((s: any) => s.minimizeSession);
    const closeSession = useWorkflowStore((s: any) => s.closeSession);

    const onClickMinimize = useCallback(() => {
        if (menuCode) minimizeSession(menuCode);
        setActiveSubmenu(null);
    }, [menuCode, minimizeSession, setActiveSubmenu]);

    const onClickClose = useCallback(() => {
        if (menuCode) closeSession(menuCode);
        setActiveSubmenu(null);
    }, [menuCode, closeSession, setActiveSubmenu]);

    if (!menuCode || !item) return null;

    const definitions = layerSchema?.definition ?? [];

    return (
        <div className={styles.container}>
            {/* 헤더 */}
            <div className={styles.header}>
                <div className={styles.titleWrap}>
                    <div className={styles.titleDot} />
                    <span className={styles.title}>
                        {layerSchema ? `${layerSchema.layerName} 스키마 설정` : '스키마 설정'}
                    </span>
                </div>
                <div className={styles.headerActions}>
                    {layerSchema && (
                        <button onClick={handleSaveAll} className={styles.saveBtn}>
                            전체 저장
                        </button>
                    )}
                    <button onClick={onClickMinimize} className={styles.closeBtn} title="최소화">
                        <FontAwesomeIcon icon={faMinus} />
                    </button>
                    <button onClick={onClickClose} className={styles.closeBtn} title="닫기">
                        <FontAwesomeIcon icon={faClose} />
                    </button>
                </div>
            </div>

            {/* 바디 */}
            {!layerSchema ? (
                <div className={styles.emptyWrap}>
                    <span className={styles.emptyIcon}>⚠</span>
                    <span className={styles.emptyTitle}>스키마 데이터가 없습니다</span>
                    <span className={styles.emptyDesc}>
                        이 레이어에 등록된 스키마가 없습니다.<br />
                        서버에서 스키마 정보를 불러올 수 없습니다.
                    </span>
                </div>
            ) : definitions.length === 0 ? (
                <div className={styles.emptyWrap}>
                    <span className={styles.emptyIcon}>⚠</span>
                    <span className={styles.emptyTitle}>정의된 스키마가 없습니다</span>
                    <span className={styles.emptyDesc}>
                        이 레이어에 스키마 정의가 없습니다.
                    </span>
                </div>
            ) : (
                <div className={styles.body}>
                    {definitions.map((schema) => (
                        <SchemaTable
                            key={schema.id}
                            schema={schema}
                            schemaColumns={layerSchema.schemaColumns}
                            onChange={handleSetSchema}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default SchemaSetting;
