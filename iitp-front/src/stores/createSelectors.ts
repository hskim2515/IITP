import { StoreApi, UseBoundStore } from 'zustand';

type WithStateActions<S> = S extends UseBoundStore<StoreApi<infer T>>
    ? S & {
    state: { [K in keyof T as T[K] extends Function ? never : K]: () => T[K] };
    actions: { [K in keyof T as T[K] extends Function ? K : never]: () => T[K] };
}
    : never;

/**
 * 스토어 정의 내에서 .state 와 .actions 네임스페이스를 자동 생성
 * 
 * 적용예시
 * 
 * export const useOpenLayersStore = createSelectors(create<
 * 
 * 호출 예시
 * 
 * const olMap  = useOpenLayersStore.state.map();
 */
export function createSelectors<S extends UseBoundStore<StoreApi<object>>>(
    baseStore: S,
): WithStateActions<S> {
    const store = baseStore as WithStateActions<S>;
    store.state = {} as any;
    store.actions = {} as any;

    const initial = store.getState();
    for (const [key, value] of Object.entries(initial)) {
        if (typeof value === 'function') {
            // 함수면 actions 네임스페이스로
            (store.actions as any)[key] = () =>
                store((s: any) => s[key as keyof typeof s]);
        } else {
            // 함수 아니면 state 네임스페이스로
            (store.state as any)[key] = () =>
                store((s: any) => s[key as keyof typeof s]);
        }
    }

    return store;
}