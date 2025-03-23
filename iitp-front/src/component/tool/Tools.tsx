import React from 'react';
import { useToolStore } from '@stores/useToolStore';

const Tools = () => {
    const { toggleTools } = useToolStore();

    return (
        <div
            style={{
                position: 'fixed',
                right: '20px',
                top: '80px',
                color: 'white',
                borderRadius: '50%',
                fontSize: '20px',
                padding: '15px',
                cursor: 'pointer',
                boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
                zIndex: 1000,
            }}
            onClick={toggleTools}
        >
            🛠️
        </div>
    );
};

export default Tools;
