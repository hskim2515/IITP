import { StoreApi, UseBoundStore } from 'zustand';

// 기존 createSelectors 함수를 그대로 사용
type WithStateActions<S> = S extends UseBoundStore<StoreApi<infer T>>
    ? S & {
    state: { [K in keyof T as T[K] extends Function ? never : K]: () => T[K] };
    actions: { [K in keyof T as T[K] extends Function ? K : never]: () => T[K] };
}
    : never;

export function createSelectors<
    T extends object,
    S extends UseBoundStore<StoreApi<T>>
>(
    baseStore: S,
): WithStateActions<S> {
    const store = baseStore as WithStateActions<S>;
    store.state = {} as any;
    store.actions = {} as any;

    const initial = store.getState();
    for (const key of Object.keys(initial)) {
        const value = initial[key as keyof typeof initial]
        if (typeof value === 'function') {
            store.actions[key as keyof typeof store.actions] = () => store((s) => s[key as keyof typeof s]) as any;
        } else {
            store.state[key as keyof typeof store.state] = () => store((s) => s[key as keyof typeof s]) as any;
        }
    }

    return store;
}

type ExtractedStore<S> = S extends UseBoundStore<StoreApi<infer T>> ? T : never;

export function useStoreSelectors<S extends WithStateActions<UseBoundStore<StoreApi<any>>>>(useStore: S) {
    const stateKeys = Object.keys(useStore.state);
    const actionsKeys = Object.keys(useStore.actions);

    const state = useStore((store) => {
        const selectedState: Record<string, any> = {};
        for (const key of stateKeys) {
            selectedState[key] = (store as any)[key];
        }
        return selectedState as ExtractedStore<S>['state'];
    });

    const actions = useStore((store) => {
        const selectedActions: Record<string, any> = {};
        for (const key of actionsKeys) {
            selectedActions[key] = (store as any)[key];
        }
        return selectedActions as ExtractedStore<S>['actions'];
    });

    return { state, actions };
}