import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from 'recharts';

interface PropertyModalProps {
    properties: Record<string, any> | null;
    onClose: () => void;
}

const numericKeysToShow = [
    'ffSpd', 'maxSpd', 'minSpd', 'waveSpd', 'width', 'length',
    'qmax', 'maxVeh', 'numLane', 'stopLine'
];

const PropertyModal: React.FC<PropertyModalProps> = ({ properties, onClose }) => {
    if (!properties) return null;

    const chartData = numericKeysToShow
        .filter(key => typeof properties[key] === 'number')
        .map(key => ({ name: key, value: properties[key] }));

    return (
        <div style={modalStyle}>
            <button style={closeButtonStyle} onClick={onClose}>✕</button>

            {/* 차트 표시 */}
            {chartData.length > 0 && (
                <div style={{ width: '100%', height: 200, marginBottom: '16px' }}>
                    <ResponsiveContainer>
                        <BarChart data={chartData} layout="vertical" margin={{ top: 10, bottom: 10, left: 30, right: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis dataKey="name" type="category" width={80} />
                            <Tooltip />
                            <Bar dataKey="value" fill="#8884d8">
                                <LabelList dataKey="value" position="right" />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 속성 목록 표시 */}
            {Object.entries(properties).map(([key, value]) => {
                const displayValue = Array.isArray(value)
                    ? `[${value.length} items]`
                    : typeof value === 'object' && value !== null
                        ? JSON.stringify(value)
                        : value?.toString();

                return (
                    <p key={key}>
                        <strong>{key}</strong>: {displayValue}
                    </p>
                );
            })}
        </div>
    );
};

export default PropertyModal;

const modalStyle: React.CSSProperties = {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'rgba(0, 0, 0, 0.6)',
    color: 'white',
    padding: '16px',
    borderRadius: '8px',
    maxWidth: '400px',
    maxHeight: '80vh',
    overflowY: 'auto',
    zIndex: 998,
    backdropFilter: 'blur(5px)',
    boxShadow: '0 0 12px rgba(0,0,0,0.3)',
};

const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '8px',
    right: '12px',
    background: 'transparent',
    color: 'white',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
};
