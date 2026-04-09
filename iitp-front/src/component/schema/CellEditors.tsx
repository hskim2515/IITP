import React, { memo, useRef, useEffect, useCallback, useMemo, useState, KeyboardEvent } from "react";
import styles from "@css/CellEditors.module.css";

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
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            const len = String(value || "").length;
            inputRef.current.setSelectionRange(len, len);
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
            if (!inputRef.current?.contains(document.activeElement)) {
                onBlur?.();
            }
        }, 0);
    };

    return (
        <input
            ref={inputRef}
            type="text"
            className={styles.input}
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
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            const len = String(value || "").length;
            inputRef.current.setSelectionRange(len, len);
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
            if (!inputRef.current?.contains(document.activeElement)) {
                onBlur?.();
            }
        }, 0);
    };

    return (
        <input
            ref={inputRef}
            type="number"
            className={styles.input}
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
    const selectRef = useRef<HTMLSelectElement>(null);

    useEffect(() => {
        if (autoFocus && selectRef.current) {
            selectRef.current.focus();
        }
    }, [autoFocus]);

    const normalizedValue = typeof value === "boolean" ? String(value) : (value ?? "");
    const normalizedOptions = options.map((opt) => ({
        ...opt,
        value: typeof opt.value === "boolean" ? String(opt.value) : opt.value,
    }));

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        let finalValue: any = val;
        if (val === "true") finalValue = true;
        else if (val === "false") finalValue = false;
        onChange(finalValue);
        setTimeout(() => onBlur?.(), 0);
    };

    return (
        <select
            ref={selectRef}
            className={styles.select}
            value={normalizedValue}
            onChange={handleChange}
            onBlur={onBlur}
        >
            {normalizedOptions.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
});

export const CheckboxEditor = memo<CellEditorProps>(function CheckboxEditor({
    value,
    onChange,
    onBlur,
}) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.checked);
        setTimeout(() => onBlur?.(), 0);
    };

    return (
        <div className={styles.checkboxWrap}>
            <input
                type="checkbox"
                className={styles.checkbox}
                checked={Boolean(value)}
                onChange={handleChange}
            />
        </div>
    );
});

export const TextareaEditor = memo<CellEditorProps>(function TextareaEditor({
    value,
    onChange,
    onBlur,
    autoFocus,
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (autoFocus && textareaRef.current) {
            textareaRef.current.focus();
            const len = String(value || "").length;
            textareaRef.current.setSelectionRange(len, len);
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
            if (!textareaRef.current?.contains(document.activeElement)) {
                onBlur?.();
            }
        }, 0);
    };

    return (
        <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={value || ""}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
        />
    );
});

export const TagsEditor = memo<
    CellEditorProps & {
    suggestions?: string[];
    commitOnChange?: boolean;
}
>(function TagsEditor({
    value,
    onChange,
    onBlur,
    autoFocus,
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const originalItemsRef = useRef<TagItem[]>([]);
    const [draft, setDraft] = useState<string[]>([]);
    const [inputVal, setInputVal] = useState("");

    useEffect(() => {
        const items = toTagItems(value);
        originalItemsRef.current = items;
        setDraft(items.map((i) => i.value));
    }, [value]);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

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

    const addTag = useCallback((tag: string) => {
        const trimmed = tag.trim();
        if (!trimmed || draft.includes(trimmed)) return;
        const next = [...draft, trimmed];
        setDraft(next);
        setInputVal("");
        commit(next);
    }, [draft, commit]);

    const removeTag = useCallback((tag: string) => {
        const next = draft.filter((t) => t !== tag);
        setDraft(next);
        commit(next);
    }, [draft, commit]);

    const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            addTag(inputVal);
        } else if (e.key === "Backspace" && inputVal === "" && draft.length > 0) {
            removeTag(draft[draft.length - 1]!);
        }
    }, [inputVal, draft, addTag, removeTag]);

    const handleBlur = useCallback(() => {
        if (inputVal.trim()) {
            addTag(inputVal);
        }
        setTimeout(() => onBlur?.(), 0);
    }, [inputVal, addTag, onBlur]);

    return (
        <div
            className={styles.tagsWrap}
            onClick={() => inputRef.current?.focus()}
        >
            {draft.map((tag) => (
                <span key={tag} className={styles.tag}>
                    {tag}
                    <button
                        type="button"
                        className={styles.tagRemove}
                        onMouseDown={(e) => { e.preventDefault(); removeTag(tag); }}
                    >
                        ×
                    </button>
                </span>
            ))}
            <input
                ref={inputRef}
                className={styles.tagInput}
                value={inputVal}
                placeholder={draft.length === 0 ? "입력 후 Enter" : ""}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={handleBlur}
            />
        </div>
    );
});
