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
