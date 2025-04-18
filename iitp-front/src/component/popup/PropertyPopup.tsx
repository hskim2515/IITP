import React, { ChangeEvent, FC, FormEvent, useState } from 'react';
import "/static/css/styles.css";
export interface fieldType {
    [key: string]: string;
}

export interface PropertyFormProps {
    open: boolean;
    title: string;
    fields: fieldType[];
    onClose: () => void;
    onSubmit: (data: fieldType) => void;
}
// popup과 병합
const PropertyForm: FC<PropertyFormProps> = ({ open, title, fields, onClose, onSubmit }) => {
    // Active form 상태: 초기값 및 변경 감지
    const [formData, setFormData] = useState<fieldType>(() =>
        fields.reduce((acc, field) => ({ ...acc, [field.name]: '' }), {})
    );

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    return (
        <PropertyPopup open={open} title={title} onClose={onClose} onSubmit={handleSubmit}>
            <form className="property-form" onSubmit={handleSubmit}>
                {fields.map(({ name, label, type }) => (
                    <div key={name} className="form-field">
                        <label htmlFor={name}>{label}</label>
                        <input
                            id={name}
                            name={name}
                            type={type ?? 'text'}
                            value={formData[name]}
                            onChange={handleChange}
                        />
                    </div>
                ))}
            </form>
        </PropertyPopup>
    );
};

export default PropertyForm;

interface PropertyPopupProps {
    open: boolean;
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    onSubmit: () => void;
}

export const PropertyPopup: FC<PropertyPopupProps> = ({ open, title, children, onClose, onSubmit }) => {
    if (!open) return null;
    console.log(title)
    return (
        <div className="popup-overlay" onClick={onClose}>
            <div className="popup-container" onClick={ event => event.stopPropagation()}>
                <div className="popup-header">{title}</div>
                <div className="popup-body">{children}</div>
                <div className="popup-footer">
                    <button className="popup-button submit" onClick={onSubmit}>
                        Submit
                    </button>
                    <button className="popup-button cancel" onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
