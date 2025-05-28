import React, { useEffect, useState } from 'react';
import ColorInput from "../util/ColorInput";
import { apiConfig, ApiMenuKey } from "../../config/apiConfig";
import axiosInstance from "../../api/axiosInstance";
import FileInput from "../util/FileInput";
import {MenuTree} from "@stores/useMenuStore";

interface SelectOption {
    value: string;
    label: string;
}

interface DynamicInputProps {
    activePopupMenu: MenuTree;
    propsOptions?: (string | { value: string; label: string })[];
    type: 'text' | 'number' | 'select' | 'file' | 'color';
    value: string | File | null;
    onChange: (value: string | File | null) => void;
    readOnly?: boolean;
}

const DynamicInput: React.FC<DynamicInputProps> = ({ activePopupMenu, propsOptions, type, value, onChange, readOnly = false }) => {
    const [options, setOptions] = useState<SelectOption[]>([]);

    useEffect(() => {
        if (type !== 'select') return;

        if (propsOptions && propsOptions.length > 0) {
            const parsed = propsOptions.map(opt =>
                typeof opt === 'string' ? {value: opt, label: opt} : opt
            );
            setOptions(parsed);
            return;
        } else{
            fetchOptions();
        }
    }, [activePopupMenu.menuCode, type, propsOptions]);

    const stringValue = typeof value === 'string' ? value : '';

    const fetchOptions = async () => {
        try {
            const api = apiConfig[activePopupMenu.menuCode as ApiMenuKey].selectList;
            const response = await axiosInstance(api);
            const parsed = response.data.map((item: any) => ({
                value: item.name,
                label: item.name,
            }));
            setOptions(parsed);
        } catch (err) {
            console.error("select 옵션 로딩 실패", err);
        }
    };

    switch (type) {
        case 'text':
        case 'number':
            return (
                <input
                    type={type}
                    value={stringValue}
                    onChange={(e) => onChange(e.target.value)}
                    readOnly={readOnly}
                />
            );

        case 'color':
            return (
                <ColorInput
                    value={stringValue || '#000000'}
                    onChange={onChange}
                    readOnly={readOnly}
                />
            );

        case 'select':
            return (
                <select
                    value={stringValue}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={readOnly}
                >
                    {options.map(({ value, label }) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            );

        case 'file':
            return (
                <FileInput
                    value={value}
                    onChange={(val) => onChange(val)}
                    readOnly={readOnly}
                />
            );

        default:
            return null;
    }
};

export default DynamicInput;
