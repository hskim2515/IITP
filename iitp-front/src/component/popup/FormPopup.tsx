import React, { FC, useEffect, useState } from 'react';
import { SimpleForm } from './SimpleForm';
import { TableForm } from './TableForm';
import {apiConfig, ApiMenuKey} from "@config/apiConfig";
import axiosInstance from "../../api/axiosInstance";
import {PropertyFormSchemaProps} from "@schema/propertyFormSchema";
import {MenuTree} from "@stores/useMenuStore";

interface InsertPopupProps {
    activePopupMenu: MenuTree;
    mode: 'create' | 'edit' | 'view';
    open: boolean;
    config: PropertyFormSchemaProps
    onClose: () => void;
    onSubmit: () => void;
    targetId: number;
    onEditMode: (mode:string) => void;
}

const FormPopup: FC<InsertPopupProps> = ({
                                             activePopupMenu, mode, open,config, onClose, onSubmit, targetId, onEditMode
                                         }) => {
    const [isReadOnly, setIsReadOnly] = useState<boolean>(mode === 'view');
    const isTableMode = config.rowFields.length > 0;

    const [formData, setFormData] = useState<any>(
        isTableMode
            ? Array(config.rowFields.length).fill(null).map(() => Array(config.inputFields.length).fill(''))
            : Array(config.inputFields.length).fill('')
    );

    const [metaData, setMetaData] = useState<Record<string, string>>(
        Object.fromEntries(config.fields.map(({ name }) => [name, '']))
    );

    useEffect(() => {
        setIsReadOnly(mode === 'view');
    }, [mode]);

    const handleChange = (rowIdx: number, colIdx: number, value: string) => {
        const updated = [...formData];
        updated[rowIdx][colIdx] = value;
        setFormData(updated);
    };

    const handleChangeMeta = (key: string, value: string) => {
        setMetaData((prev) => ({ ...prev, [key]: value }));
    };

    const handleSimpleChange = (idx: number, value: string | File | null) => {
        const updated = [...formData];
        updated[idx] = value;
        setFormData(updated);
    };

    const handleSubmitTable = async (e: React.FormEvent) => {
        e.preventDefault();
        const transformedData = config.rowFields.reduce((acc, row, rowIdx) => {
            config.inputFields.forEach((col, colIdx) => {
                const parameterName = row.name;
                const fieldName = col.name;
                acc[parameterName] = acc[parameterName] || {};
                acc[parameterName][fieldName] = formData[rowIdx][colIdx];
            });
            return acc;
        }, {} as Record<string, Record<string, any>>);

        const mergedData = {
            ...transformedData,
            ...metaData
        };
        try {
            const { url, method, useFormData } = mode === 'create'
                ? apiConfig[activePopupMenu.menuCode as ApiMenuKey].create
                : apiConfig[activePopupMenu.menuCode as ApiMenuKey].update;

            const finalUrl = url.includes('{id}') && targetId !== null
                ? url.replace('{id}', String(targetId))
                : url;

            await axiosInstance.request({
                url: finalUrl,
                method,
                data: mergedData,
            });

            alert(mode === 'create' ? '등록되었습니다.' : '수정되었습니다.');
            onSubmit();
            onClose();
        } catch (error) {
            console.error(`${mode === 'create' ? '등록' : '수정'} 실패:`, error);
            alert(`${mode === 'create' ? '등록' : '수정'} 중 오류가 발생했습니다.`);
        }
    };

    const handleSubmitSimple = async (e: React.FormEvent) => {
        e.preventDefault();

        const fileFieldIdx = config.inputFields.findIndex(field => field.type === 'file');
        const file = fileFieldIdx >= 0 ? formData[fileFieldIdx] as File : null;

        try {
            const { url, method, useFormData } = mode === 'create'
                ? apiConfig[activePopupMenu.menuCode as ApiMenuKey].create
                : apiConfig[activePopupMenu.menuCode as ApiMenuKey].update;

            const dataObj = config.inputFields.reduce((acc, field, idx) => {
                if (field.type !== 'file') {
                    acc[field.name] = formData[idx];
                }
                return acc;
            }, {} as Record<string, any>);

            const finalUrl = url.includes('{id}') && targetId !== null
                ? url.replace('{id}', String(targetId))
                : url;

            let dataToSend;

            if (useFormData) { //file 데이터 포함
                const formDataToSend = new FormData();
                Object.entries(dataObj).forEach(([key, value]) => {
                    formDataToSend.append(key, value);
                });
                if (file) {
                    formDataToSend.append('file', file);
                }
                dataToSend = formDataToSend;
            } else {
                dataToSend = dataObj;
            }

            await axiosInstance.request({
                url: finalUrl,
                method,
                data: dataToSend,
            });

            alert(mode === 'create' ? '등록되었습니다.' : '수정되었습니다.');
            onSubmit();
            onClose();

        } catch (error) {
            console.error(`${mode === 'create' ? '등록' : '수정'} 실패:`, error);
            alert(`${mode === 'create' ? '등록' : '수정'} 중 오류가 발생했습니다.`);
        }
    };

    const fetchDetail = async (targetId: number, mode: string, menuCode: ApiMenuKey) => {
        if (!targetId || (mode !== 'view' && mode !== 'edit')) return { mappedFormData: [], mappedMetaData: {} };

        try {
            const api = apiConfig[menuCode].detail;
            const response = await axiosInstance({
                method: api.method,
                url: api.url.replace('{id}', `${targetId}`),
            });

            const rawData = response.data;

            let mappedFormData: string[][] = [];
            let mappedMetaData: Record<string, string> = {};

            if (Array.isArray(rawData) && rawData.length > 0) {
                mappedFormData = rawData.map(item =>
                    config.inputFields.map(col => item[col.name] ?? '')
                );

                mappedMetaData = config.fields.reduce((acc, col) => {
                    acc[col.name] = rawData[0][col.name] ?? '';
                    return acc;
                }, {} as Record<string, string>);
            } else if (typeof rawData === 'object' && rawData !== null) {
                mappedFormData = config.inputFields.map(col => rawData[col.name] ?? '');
            } else {
                mappedFormData = [];
                mappedMetaData = {};
            }

            return { mappedFormData, mappedMetaData };
        } catch (error) {
            console.error('상세 정보 조회 실패', error);
            return [];
        }
    };

    useEffect(() => {
        if (!open) return;
        const inputLen = config.inputFields.length;
        const rowLen = config.rowFields.length;

        const initial = rowLen > 0
            ? Array(rowLen).fill(null).map(() => Array(inputLen).fill(''))
            : Array(inputLen).fill('');
        setFormData(initial);
    }, [open, config.inputFields, config.rowFields]);

    useEffect(() => {
        if (mode !== 'view' || !open) return;
        const loadData = async () => {
            const data: { mappedFormData: string[][]; mappedMetaData: Record<string, string> } | undefined =
                await fetchDetail(targetId, mode, activePopupMenu.menuCode as ApiMenuKey)
            if (!data) return;
            setFormData(data.mappedFormData);
            setMetaData(data.mappedMetaData);
        };

        loadData();
    }, [targetId, mode, activePopupMenu.menuCode, config.inputFields]);

    if (!open) return null;

    return isTableMode ? (
        <TableForm
            {...{ activePopupMenu, config, formData, metaData, handleChange, handleChangeMeta, handleSubmitTable, isReadOnly, mode, onClose, onEditMode, targetId }}
        />
    ) : (
        <SimpleForm
            {...{ activePopupMenu, config, formData, handleSimpleChange, handleSubmitSimple, isReadOnly, mode, onClose, onEditMode, targetId }}
        />
    );

};

export default FormPopup;
