import React from 'react';
import { HexColorPicker } from 'react-colorful';

interface ColorInputProps {
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
}

const ColorInput: React.FC<ColorInputProps> = ({ value, onChange, readOnly = false }) => {
    return (
        <div style={{ pointerEvents: readOnly ? 'none' : 'auto', opacity: readOnly ? 0.5 : 1, marginTop:15 }}>
            <HexColorPicker color={value || '#000000'} onChange={onChange} />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={readOnly}
                style={{ marginTop: 8, width: '100%' }}
            />
        </div>
    );
};

export default ColorInput;
