import { useEffect, useState, useRef, useCallback } from "react";

type UseWorkerResult = [
    result: string | null,
    postMessage: (message: string) => void
];

const useWorker = ({ url }: { url: string }): UseWorkerResult => {
    const [result, setResult] = useState(null);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        workerRef.current = new Worker(url);

        workerRef.current.onmessage = (e) => {
            setResult(e.data);
        };

        return () => {
            if (workerRef.current) workerRef.current.terminate();
        };
    }, [url]);

    const postMessage = useCallback((message: string) => {
        if (workerRef.current) workerRef.current.postMessage(message);
    }, []);

    return [result, postMessage];
};

export default useWorker;