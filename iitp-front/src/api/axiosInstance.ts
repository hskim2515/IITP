import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import type {
    HttpMethod,
    UpperHttpMethod,
    Paths,
    PathParams,
    QueryParams,
    HeaderParams,
    RequestBody,
} from "@type/Api";

function interpolatePath(path: string, params?: Record<string, unknown>) {
    if (!params) return path;
    return path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(String(params[key])));
}

const axiosInstance: AxiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    headers: {
        "Content-Type": "application/json",
    },
    // 안전망 타임아웃 — 기존엔 무제한이라 서버(원격 파일 서버 등)가 무응답이면
    // "스피너만 계속 도는" 증상으로 이어졌다(개발서버 재현 보고). 대형 네트워크
    // 최초 로드/SQLite 재빌드가 수십 초 걸릴 수 있어(NetworkTileManager 주석 참고)
    // 넉넉히 90s로 — 그 안엔 backend 자체 타임아웃(RemoteXmlFetch, 최대 ~28s)이
    // 먼저 에러 응답을 주므로 정상 케이스에선 이 타임아웃에 걸리지 않는다.
    timeout: 90_000,
});

axiosInstance.interceptors.request.use((config) => {
    const token = localStorage.getItem("accessToken");
    if (token) {
        // headers가 없을 수 있으니 방어
        config.headers = config.headers ?? {};
        (config.headers as any).Authorization = `Bearer ${token}`;
    }

    if (config.data instanceof FormData) {
        config.headers = config.headers ?? {};
        delete (config.headers as any)["Content-Type"];
    } else {
        config.headers = config.headers ?? {};
        (config.headers as any)["Content-Type"] = "application/json";
    }

    return config;
});

export async function apiRequest<
    P extends keyof Paths,
    M extends HttpMethod
>(options: {
    path: P;
    method: M;
    params?: PathParams<P, M> extends Record<string, unknown> ? PathParams<P, M> : never;
    query?: QueryParams<P, M> extends Record<string, unknown> ? QueryParams<P, M> : never;
    headers?: HeaderParams<P, M> extends Record<string, unknown> ? HeaderParams<P, M> : never;
    body?: RequestBody<P, M>;
    config?: Omit<AxiosRequestConfig, "url" | "method" | "params" | "headers" | "data"> & {
        signal?: AbortSignal;
    };
}) {
    const { path, method, params, query, headers, body, config } = options;

    const url = interpolatePath(path as string, params as any);

    const res = await axiosInstance.request({
        url,
        method: (method.toUpperCase() as UpperHttpMethod) ?? "GET",
        params: query as any,
        headers: headers as any,
        data: body as any,
        ...(config ?? {}),
    });

    return res.data as unknown;
}

export default axiosInstance;
