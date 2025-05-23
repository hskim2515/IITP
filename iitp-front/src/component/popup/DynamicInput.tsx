import React, { useEffect, useState } from 'react';
import ColorInput from "../util/ColorInput";
import { apiConfig, ApiMenuKey } from "../../config/apiConfig";
import axiosInstance from "../../api/axiosInstance";

interface SelectOption {
    value: string;
    label: string;
}

interface DynamicInputProps {
    menuCode: string;
    type: 'text' | 'number' | 'select' | 'file' | 'color';
    value: string | File | null;
    onChange: (value: string | File | null) => void;
    readOnly?: boolean;
}

const DynamicInput: React.FC<DynamicInputProps> = ({ menuCode, type, value, onChange, readOnly = false }) => {
    const [options, setOptions] = useState<SelectOption[]>([]);
    const baseUrl = process.env.REACT_APP_FILE_BASE_URL || '';

    useEffect(() => {
        if (type !== 'select') return;

        const fetchOptions = async () => {
            try {
                const config = apiConfig[menuCode as ApiMenuKey].selectList;
                const response = await axiosInstance(config);
                const parsed = response.data.map((item: any) => ({
                    value: item.name,
                    label: item.name
                }));
                setOptions(parsed);
            } catch (err) {
                console.error("select 옵션 로딩 실패", err);
            }
        };

        fetchOptions();
    }, [menuCode, type]);

    const stringValue = typeof value === 'string' ? value : '';

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
                    <option value="">선택안함</option>
                    {options.map(({ value, label }) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            );

        case 'file':
            const fileName = stringValue.split('/').pop();
            return (
                <div>
                    {stringValue && (
                        <div>
                            <a href={baseUrl + stringValue} target="_blank" rel="noopener noreferrer">
                                {fileName}
                            </a>
                        </div>
                    )}
                    {!readOnly && (
                        <input
                            type="file"
                            onChange={(e) => onChange(e.target.files?.[0] || null)}
                        />
                    )}
                </div>
            );

        default:
            return null;
    }
};

export default DynamicInput;
