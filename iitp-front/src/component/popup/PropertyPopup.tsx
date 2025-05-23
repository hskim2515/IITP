import React, {FC, useEffect, useRef, useState} from 'react';
import "/static/css/styles.css";
import ListTable, {ListTableRef} from "./ListTable"
import FormPopup from "./FormPopup";
import {apiConfig, ApiMenuKey} from "../../config/apiConfig";
import axiosInstance from "../../api/axiosInstance";

export interface fieldType {
    [key: string]: string;
}

export interface PropertyFormProps {
    open: boolean;
    title: string;
    menuCode: string;
    fields: fieldType[];
    inputFields: fieldType[];
    rowFields: fieldType[];
    onClose: () => void;
    type: string;
}

const tabComponent: Record<string, React.FC<PropertyFormProps>> = {
    table: ListTable,
    //file: FilePopup
};

const PropertyForm: FC<PropertyFormProps> = ({ open, title, menuCode, fields, inputFields, rowFields, onClose, type }) => {
    const [mode, setMode] = useState<string>('view');
    const [targetId, setTargetId] = useState<string | number | null>(null);

    const [data, setData] = useState<any[]>([]);
    const [isInsertPopupOpen, setIsInsertPopupOpen] = useState(false);

    const tableRef = useRef<ListTableRef>(null);

    useEffect(() => {
        if (!open) return;
        setData([]);
        fetchData();
    }, [open, menuCode]);

    const fetchData = async () => {
        try {
            const config = apiConfig[menuCode as ApiMenuKey].list;
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
            const config = apiConfig[menuCode as ApiMenuKey].delete;

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

    const ActiveComponent = tabComponent[type];

    return (
        <>
            <PropertyPopup open={open} title={title} onClose={onClose} type={type} inputFields={inputFields} rowFields={rowFields} mode={mode} onEditMode={handleEditMode} onDelete={handleDelete} >
                {ActiveComponent && (
                    <ActiveComponent
                        ref={tableRef}
                        title={title}
                        fields={fields}
                        onClose={onClose}
                        open={open}
                        type={type}
                        data={data}
                        onEditMode={handleEditMode}
                    />
                )}
            </PropertyPopup>

            {isInsertPopupOpen && (
                <FormPopup
                    menuCode={menuCode}
                    mode={mode}
                    open={isInsertPopupOpen}
                    fields={fields}
                    inputFields={inputFields}
                    rowFields={rowFields}
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
    title: string;
    inputFields: fieldType[];
    rowFields: fieldType[];
    children: React.ReactNode;
    onClose: () => void;
    type: string;
    mode: string;
    onEditMode: (mode: string) => void;
    onDelete: () => void;
}

export const PropertyPopup: FC<PropertyPopupProps> = ({ open, title, children, onClose, type, onEditMode, onDelete }) => {
    if (!open) return null;

    return (
        <div className={`popup-overlay${type ? `-${type}` : ''}`}>
            <div className={`popup-container${type ? `-${type}` : ''}`} onClick={event => event.stopPropagation()}>
                <div className="popup-header">
                    <span>{title}</span>
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
