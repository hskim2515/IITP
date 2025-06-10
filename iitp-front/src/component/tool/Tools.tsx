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
                zIndex: 999,
            }}
            onClick={toggleTools}
        >
            🛠️
        </div>
    );
};

export default Tools;
