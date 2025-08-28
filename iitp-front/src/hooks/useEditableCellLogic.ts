import { useState, useEffect, useCallback } from 'react';

interface Props {
    value: unknown;
    onCommit: (newValue?: unknown) => void
}

/**
 * EditableCell의 편집 상태 및 커밋 로직을 관리하는 커스텀 훅
 * @param {any} value - 부모로부터 받은 원본 값
 * @param {Function} onCommit - 최종 변경사항을 부모에게 알리는 콜백 함수
 * @returns {object} - { tempValue, handleChange, handleCommit }
 */
export function useEditableCellLogic({value, onCommit}:Props) {
    // 1. 편집 중인 값을 임시로 저장하는 로컬 상태
    const [tempValue, setTempValue] = useState(value);

    // 2. 외부 'value' prop이 변경되면 로컬 상태를 동기화
    useEffect(() => {
        setTempValue(value);
    }, [value]);

    // 3. 로컬 상태(tempValue)를 업데이트하는 핸들러
    const handleChange = useCallback((newValue) => {
        setTempValue(newValue);
    }, []);

    // 4. 최종 변경사항을 부모 컴포넌트로 커밋하는 핸들러
    const handleCommit = useCallback(() => {
        // 실제 값이 변경되었을 때만 업데이트 실행
        if (!Object.is(value, tempValue)) {
            onCommit(tempValue);
        }
    }, [value, tempValue, onCommit]);

    return {
        tempValue,
        handleChange,
        handleCommit,
    };
}