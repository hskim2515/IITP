import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSchemaStore } from "@stores/useSchemaStore";
import { useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClose } from "@fortawesome/free-solid-svg-icons/faClose";
import { SchemaTable } from "@component/schema/SchemaTable";
import debounce from "lodash.debounce";
import { LayerSchemaResponse, SchemaDefinition } from "@type/openapi.gen";
import styles from "@css/SchemaSetting.module.css"

// 스키마 설정 컴포넌트
const SchemaSetting = () => {

    const {
        activeSubmenu,
        setActiveSubmenu,
    } = useMenuStore();

    const getSchemaByLayerName = useSchemaStore((state) => state.getLayerSchemaByLayerName);
    const setCurrentSchema = useSchemaStore((state) => state.setCurrentSchema);
    const updateSchema = useSchemaStore((state) => state.updateSchema);

    if(!activeSubmenu?.menuCode) return;

    const item = propertyFormSchema[activeSubmenu.menuCode];
    const layerName = item?.layer
    if (!item || !layerName) {
        return null;
    }

    const initialLayerSchema = useMemo(() => {
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
                setCurrentSchema(layerName, nextLayer);
            }, 300),
        [setCurrentSchema, layerName]
    );

    const onClickClose = () => {
        setActiveSubmenu(null)
    }

    const handleSetSchema = useCallback(
        (updatedSchema: SchemaDefinition) => {
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
        }, [debouncedSetUpdated,setCurrentSchema,layerName]
    );

    const handleSaveAll = useCallback(async () => {
        if (!layerSchema) return;

        setCurrentSchema(layerName, layerSchema);
        console.log("layerSchema:::",layerSchema)
        await updateSchema(layerName);
    }, [layerSchema, layerName, updateSchema]);

    if (!layerSchema) {
        return <div></div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.title}>
                    {`${layerSchema.layerName} 스키마 설정`}
                </span>
                <div>
                    <button onClick={handleSaveAll} className="grid-btn add-btn" style={{marginRight: "10px"}}>
                        전체 저장
                    </button>
                    <FontAwesomeIcon className="close-btn" icon={faClose} onClick={onClickClose} style={{cursor: "pointer"}}/>
                </div>
            </div>

            {(layerSchema.definition?? []).map((schema) => (
                <SchemaTable
                    key={schema.id}
                    schema={schema}
                    schemaColumns={layerSchema.schemaColumns}
                    onChange={handleSetSchema}
                />
            ))}
        </div>
    );
};

export default SchemaSetting;
