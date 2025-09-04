import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSchemaStore } from "@stores/useSchemaStore";
import { MenuTree, useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClose } from "@fortawesome/free-solid-svg-icons/faClose";
import { Schema, LayerSchema } from "@type/Schema";
import { SchemaTable } from "@component/schema/SchemaTable";
import debounce from "lodash.debounce";

export interface Props {
    activeSubmenu: MenuTree;
    onClose: () => void;
}

// 스키마 설정 컴포넌트
const SchemaSetting = ({activeSubmenu, onClose}: Props) => {
    const submenu = {
        menuCode: activeSubmenu.menuCode,
        item: propertyFormSchema[activeSubmenu.menuCode],
        title: activeSubmenu.nameKor
    };

    const activeDropdownMenu = useMenuStore((state) => state.activeDropdownMenu);

    const getSchemaByLayerName = useSchemaStore((state) => state.getLayerSchemaByLayerName);
    const setCurrentSchema = useSchemaStore((state) => state.setCurrentSchema);
    const updateSchema = useSchemaStore((state) => state.updateSchema);

    const initialLayerSchema = useMemo(() => {
        const schema = getSchemaByLayerName(submenu.item.layer);
        return schema ? (typeof structuredClone === "function" ? structuredClone(schema) : JSON.parse(JSON.stringify(schema))) : null;
    }, [getSchemaByLayerName, submenu.item.layer]);

    const [layerSchema, setLayerSchema] = useState<LayerSchema | null>(initialLayerSchema);

    useEffect(() => {
        setLayerSchema(initialLayerSchema);
    }, [initialLayerSchema]);

    const debouncedSetUpdated = useMemo(
        () =>
            debounce((nextLayer: LayerSchema) => {
                setCurrentSchema(submenu.item.layer, nextLayer);
            }, 300),
        [setCurrentSchema, submenu.item.layer]
    );

    const handleSetSchema = useCallback(
        (updatedSchema: Schema) => {
            setLayerSchema((prev) => {
                if (!prev) return prev;

                const next: LayerSchema = {
                    ...prev,
                    schemata: prev.schemata.map((s) => (s.id === updatedSchema.id ? updatedSchema : s)),
                };

                setCurrentSchema(submenu.item.layer, next);

                return next;
            });
        }, [debouncedSetUpdated,setCurrentSchema,submenu.item.layer]
    );

    const handleSaveAll = useCallback(async () => {
        if (!layerSchema) return;

        setCurrentSchema(submenu.item.layer, layerSchema);
        console.log("layerSchema:::",layerSchema)
        await updateSchema(submenu.item.layer);
    }, [layerSchema, submenu.item.layer, updateSchema]);

    const isSidebarVisible =
        !!activeDropdownMenu &&
        !(activeDropdownMenu.menuCode === "FACILITY" && !!activeSubmenu);
    const panelWidth = isSidebarVisible ? 250 : 0;

    if (!layerSchema) {
        return <div></div>;
    }

    return (
        <div
            className="schema-container"
            style={{
                position: "fixed",
                left: `${panelWidth}px`,
                right: 0,
                zIndex: 1000,
                backgroundColor: "#1e1e1e",
                borderRadius: "8px",
                width: `calc(100vw - ${panelWidth}px)`,
                top: 50,
                height: "calc(100vh - 50px)",
                overflowY: "scroll",
                padding: "20px",
            }}
        >
            <div
                className="schema-header"
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "20px",
                }}
            >
                <span style={{fontSize: "1.2rem", fontWeight: "bold"}}>
                    {`${layerSchema.layerName} 스키마 설정`}
                </span>
                <div>
                    <button onClick={handleSaveAll} className="grid-btn add-btn" style={{marginRight: "10px"}}>
                        전체 저장
                    </button>
                    <FontAwesomeIcon className="close-btn" icon={faClose} onClick={onClose} style={{cursor: "pointer"}}/>
                </div>
            </div>

            {layerSchema.schemata.map((schema) => (
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
