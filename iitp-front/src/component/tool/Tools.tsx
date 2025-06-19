import React from 'react';
import { useToolStore } from '@stores/useToolStore';
import {faChevronDown, faChevronRight, faChevronUp, faLayerGroup} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";

const Tools = () => {
    const { toggleTools, showTools } = useToolStore();

    console.log(showTools)

    return (
        <div
            style={{
                position: 'fixed',
                right: '20px',
                top: '50px',
                color: 'white',
                borderRadius: '50%',
                fontSize: '20px',
                padding: '15px',
                cursor: 'pointer',
                zIndex: 999,
            }}
            onClick={toggleTools}
        >

            <FontAwesomeIcon icon={showTools ? faChevronUp : faChevronDown} />

        </div>
    );
};

export default Tools;
