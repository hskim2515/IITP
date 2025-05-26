import React from 'react';

interface Props {
    value: string;
}

const ColorCellRenderer: React.FC<Props> = ({ value }) => {
    const color = value || '#000000';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
                style={{
                    width: '20px',
                    height: '20px',
                    backgroundColor: color,
                    border: '1px solid #ccc',
                    borderRadius: '3px',
                }}
            />
            <span>{color}</span>
        </div>
    );
};


export default ColorCellRenderer;
