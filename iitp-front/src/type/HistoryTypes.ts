export type UpdateType = 'added' | 'modified' | 'deleted';

export interface FieldChange {
    guid: string | number;
    field: string;
    oldValue: any;
    newValue: any;
}

export interface UpdateLogItem {
    timestamp: string;
    json: UpdateLogEntry;
}

export type UpdateLogEntry = {
    [key in UpdateType]?: FieldChange[];
};