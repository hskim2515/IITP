export interface GenerateTemplateOptions {
    /** 템플릿에 추가할 기본 속성들 */
    additionalProps?: Record<string, any>;
    /** 스키마 필드 중에서 템플릿에 포함하지 않을 필드 이름 목록 */
    exclude?: string[];
}

export interface Template {
    [key: string]: string | number | undefined;
}