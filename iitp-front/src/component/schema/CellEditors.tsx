import React, { memo, useRef, useEffect, useCallback, useMemo, useState, KeyboardEvent } from "react";
import { Input, Select, Checkbox, CheckboxChangeEvent } from "antd";

interface CellEditorProps {
    value: any;
    onChange: (value: any) => void;
    onBlur?: () => void;
    autoFocus?: boolean;
}

function normalizeStringList(list: string[] | undefined | null): string[] {
    if (!list) return [];
    return Array.from(
        new Set(
            list
                .map((s) => (s.trim()))
                .filter((s) => s.length > 0)
        )
    );
}

type TagItem = {id?: number | string; value: string};

function toTagItems(input: any): TagItem[] {
    if (!input) return [];
    if (Array.isArray(input)) {
        if (input.length === 0) return [];
        if (typeof input[0] === "string") {
            return (input as string[]).map((v) => ({value: v}));
        }
        return (input as any[])
            .map((x) => ({id: x?.id, value: String(x?.value ?? "")}))
            .filter((i) => i.value);
    }
    return [];
}

export const TextEditor = memo<CellEditorProps>(function TextEditor({
                                                                        value,
                                                                        onChange,
                                                                        onBlur,
                                                                        autoFocus,
                                                                    }) {
    const inputRef = useRef<any>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            const input = inputRef.current.input || inputRef.current;
            input.focus();
            const len = String(value || "").length;
            input.setSelectionRange(len, len);
        }
    }, [autoFocus, value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            onBlur?.();
        }
    };

    const handleBlur = () => {
        setTimeout(() => {
            if (!inputRef.current?.input?.contains(document.activeElement)) {
                onBlur?.();
            }
        }, 0);
    };

    return (
        <Input
            ref={inputRef}
            size="small"
            value={value || ""}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
        />
    );
});

export const NumberEditor = memo<CellEditorProps>(function NumberEditor({
                                                                            value,
                                                                            onChange,
                                                                            onBlur,
                                                                            autoFocus,
                                                                        }) {
    const inputRef = useRef<any>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            const input = inputRef.current.input || inputRef.current;
            input.focus();
            const len = String(value || "").length;
            input.setSelectionRange(len, len);
        }
    }, [autoFocus, value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === "") {
            onChange(null);
        } else {
            const num = Number(raw);
            onChange(Number.isNaN(num) ? null : num);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            onBlur?.();
        }
    };

    const handleBlur = () => {
        setTimeout(() => {
            if (!inputRef.current?.input?.contains(document.activeElement)) {
                onBlur?.();
            }
        }, 0);
    };

    return (
        <Input
            ref={inputRef}
            type="number"
            size="small"
            value={value?.toString() || ""}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
        />
    );
});

export const SelectEditor = memo<
    CellEditorProps & {options: Array<{label: string; value: any}>}
>(function SelectEditor({
                            value,
                            options,
                            onChange,
                            onBlur,
                            autoFocus,
                        }) {
    const selectRef = useRef<any>(null);

    useEffect(() => {
        if (autoFocus && selectRef.current) {
            selectRef.current.focus();
        }
    }, [autoFocus]);

    const normalizedValue = typeof value === "boolean" ? String(value) : value;
    const normalizedOptions = options.map((opt) => ({
        ...opt,
        value: typeof opt.value === "boolean" ? String(opt.value) : opt.value,
    }));

    const handleChange = (val: any) => {
        let finalValue: any = val;
        if (val === "true") finalValue = true;
        else if (val === "false") finalValue = false;
        onChange(finalValue);
        // 선택 즉시 완료
        setTimeout(() => onBlur?.(), 0);
    };

    return (
        <Select
            ref={selectRef}
            size="small"
            value={normalizedValue}
            style={{width: "100%"}}
            options={normalizedOptions}
            onChange={handleChange}
            onBlur={onBlur}
            getPopupContainer={(node) => (node ? node.ownerDocument.body : document.body)}
        />
    );
});

export const CheckboxEditor = memo<CellEditorProps>(function CheckboxEditor({
                                                                                value,
                                                                                onChange,
                                                                                onBlur,
                                                                            }) {
    const handleChange = (e: CheckboxChangeEvent) => {
        onChange(e.target.checked);
        setTimeout(() => onBlur?.(), 0);
    };

    return (
        <Checkbox
            checked={Boolean(value)}
            value={value}
            onChange={handleChange}
        />
    );
});

export const TextareaEditor = memo<CellEditorProps>(function TextareaEditor({
                                                                                value,
                                                                                onChange,
                                                                                onBlur,
                                                                                autoFocus,
                                                                            }) {
    const textareaRef = useRef<any>(null);

    useEffect(() => {
        if (autoFocus && textareaRef.current) {
            const textarea = textareaRef.current.resizableTextArea?.textArea || textareaRef.current;
            textarea.focus();
            const len = String(value || "").length;
            textarea.setSelectionRange(len, len);
        }
    }, [autoFocus, value]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onBlur?.();
        }
    };

    const handleBlur = () => {
        setTimeout(() => {
            const textarea = textareaRef.current?.resizableTextArea?.textArea || textareaRef.current;
            if (!textarea?.contains?.(document.activeElement)) {
                onBlur?.();
            }
        }, 0);
    };

    return (
        <Input.TextArea
            ref={textareaRef}
            size="small"
            value={value || ""}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoSize={{minRows: 1, maxRows: 3}}
        />
    );
});

export const TagsEditor = memo<
    CellEditorProps & {
    suggestions?: string[];    // 자동완성 후보 (선택)
    commitOnChange?: boolean;  // 변경 즉시 커밋 (기본 false)
}
>(function TagsEditor({
                          value,
                          onChange,
                          onBlur,
                          autoFocus,
                          suggestions,
                      }) {
    const selectRef = useRef<any>(null);

    const originalItemsRef = useRef<TagItem[]>([]);

    const [draft, setDraft] = useState<string[]>([]);

    useEffect(() => {
        const items = toTagItems(value);
        originalItemsRef.current = items;
        setDraft(items.map((i) => i.value));
    }, [value]);

    useEffect(() => {
        if (autoFocus && selectRef.current) {
            selectRef.current.focus();
        }
    }, [autoFocus]);

    const options = useMemo(
        () => (suggestions ?? []).map((s) => ({label: s, value: s})),
        [suggestions]
    );

    const commit = useCallback(
        (strings: string[]) => {
            const normalized = normalizeStringList(strings);
            const idMap = new Map<string, number | string | undefined>(
                originalItemsRef.current.map((it) => [it.value, it.id])
            );
            const result: TagItem[] = normalized.map((val) => {
                const existId = idMap.get(val);
                return existId !== undefined ? {id: existId, value: val} : {value: val};
            });
            onChange(result);
        },
        [onChange]
    );

    const handleChange = useCallback(
        (next: string[]) => {
            setDraft(next);
            commit(next);
        },
        [commit]
    );

    const handleBlur = useCallback(() => {
        commit(draft);
        onBlur?.();
    }, [commit, draft, onBlur]);

    const handleInputKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter") {
            const v = (e.target as HTMLInputElement).value?.trim() ?? "";
            if (v.length === 0) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    },[])

    return (
        <Select
            ref={selectRef}
            mode="tags"
            size="small"
            style={{width: "100%"}}
            placeholder="입력 후 Enter를 눌러주세요"
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            options={options}
            getPopupContainer={(node) => (node ? node.ownerDocument.body : document.body)}
            onInputKeyDown={handleInputKeyDown}
            showSearch={false}
            virtual={true}
            open={false}
        />
    );
});
