import React, {FC, useEffect, useRef, useState} from 'react';
import "/static/css/styles.css";
import ListTable, {ListTableRef} from "./ListTable"
import FormPopup from "./FormPopup";
import {apiConfig, ApiMenuKey} from "@config/apiConfig";
import axiosInstance from "../../api/axiosInstance";
import {PropertyFormSchemaProps} from "@schema/propertyFormSchema";
import {MenuTree} from "@stores/useMenuStore";

export interface fieldType {
    [key: string]: string;
}

export interface PropertyFormProps {
    open: boolean;
    config: PropertyFormSchemaProps;
    onClose: () => void;
    activePopupMenu: MenuTree;
}

const tabComponent: Record<string, React.FC<PropertyFormProps>> = {
    table: ListTable,
    //file: FilePopup
};

const PropertyForm: FC<PropertyFormProps> = ({ open, activePopupMenu, onClose, config }) => {
    const [mode, setMode] = useState<string>('view');
    const [targetId, setTargetId] = useState<string | number | null>(null);

    const [data, setData] = useState<any[]>([]);
    const [isInsertPopupOpen, setIsInsertPopupOpen] = useState(false);

    const tableRef = useRef<ListTableRef>(null);

    useEffect(() => {
        if (!open) return;
        setData([]);
        fetchData();
    }, [open, activePopupMenu.menuCode]);

    const fetchData = async () => {
        try {
            const config = apiConfig[activePopupMenu.menuCode as ApiMenuKey].list;
            const response = await axiosInstance({
                method: config.method,
                url: config.url
            });
            setData(response.data);
        } catch (err) {
            console.error("데이터 불러오기 실패", err);
        }
    };

    const handleSubmit = () => {
        fetchData();
    }

    const handleEditMode = (newMode: string , id? :number) => {
        setMode(newMode);
        setTargetId(id);
        setIsInsertPopupOpen(true);
    };

    const handleDelete = async () => {
        const selectedRows = tableRef.current?.getSelectedRows();
        if (!selectedRows || selectedRows.length === 0) {
            alert("삭제할 항목을 선택해주세요.");
            return;
        }
        try {
            const idsToDelete = selectedRows.map(row => row.id);
            const config = apiConfig[activePopupMenu.menuCode as ApiMenuKey].delete;

            await axiosInstance({
                method: config.method,
                url: config.url,
                data: idsToDelete,
            });

            handleSubmit();
            alert('삭제하였습니다.')
        } catch (err) {
            console.error("데이터 삭제하기 실패", err);
            alert("삭제 실패했습니다.");
        }
    }

    const ActiveComponent = tabComponent[config.type];

    return (
        <>
            <PropertyPopup open={open} activePopupMenu={activePopupMenu} onClose={onClose} config={config} mode={mode} onEditMode={handleEditMode} onDelete={handleDelete} >
                {ActiveComponent && (
                    <ActiveComponent
                        ref={tableRef}
                        activePopupMenu={activePopupMenu}
                        config={config}
                        onClose={onClose}
                        open={open}
                        data={data}
                        onEditMode={handleEditMode}
                    />
                )}
            </PropertyPopup>

            {isInsertPopupOpen && (
                <FormPopup
                    activePopupMenu={activePopupMenu}
                    mode={mode}
                    open={isInsertPopupOpen}
                    config={config}
                    onClose={() => setIsInsertPopupOpen(false)}
                    onSubmit={handleSubmit}
                    targetId={targetId}
                    onEditMode={handleEditMode}
                />
            )}
        </>
    );
};

export default PropertyForm;


export interface PropertyPopupProps {
    open: boolean;
    activePopupMenu:MenuTree;
    config: PropertyFormSchemaProps;
    children: React.ReactNode;
    onClose: () => void;
    mode: string;
    onEditMode: (mode: string) => void;
    onDelete: () => void;
}

export const PropertyPopup: FC<PropertyPopupProps> = ({ open, activePopupMenu, children, onClose, config, onEditMode, onDelete }) => {
    if (!open) return null;

    return (
        <div className={`popup-overlay${config.type ? `-${config.type}` : ''}`}>
            <div className={`popup-container${config.type ? `-${config.type}` : ''}`} onClick={event => event.stopPropagation()}>
                <div className="popup-header">
                    <span>{activePopupMenu.nameKor}</span>
                    <div className="popup-header-actions">
                        <button className="add-btn" onClick={() => onEditMode('create')}>추가</button>
                        <button className="delete-btn" onClick={onDelete}>삭제</button>
                    </div>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="popup-body">{children}</div>
            </div>
        </div>
    );
};
