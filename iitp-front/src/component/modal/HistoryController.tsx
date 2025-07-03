import React from "react";

type Props = {
    onHistoryAply: (type:boolean) => void;
    disabledUndo?: boolean;
    disabledRedo?: boolean;
};

const HistoryController: React.FC<Props> = ({
                                                onHistoryAply,
                                                disabledUndo = false,
                                                disabledRedo = false,
                                            }) => {


    return (
        <>
            <button onClick={()=>onHistoryAply(true)} disabled={disabledUndo}>←</button>
            <button onClick={()=>onHistoryAply(false)} disabled={disabledRedo}>→</button>
        </>

    );
};

export default HistoryController;
