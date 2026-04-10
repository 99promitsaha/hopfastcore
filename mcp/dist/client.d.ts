/**
 * HopFast API Client
 *
 * Thin wrapper around the HopFast REST API.
 * Configure HOPFAST_API_URL env var to point at your backend instance.
 * Defaults to http://localhost:8080 (local dev).
 */
export declare const HOPFAST_API_URL: string;
export declare class HopFastApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare function hopfastFetch<T>(path: string, options?: RequestInit): Promise<T>;
//# sourceMappingURL=client.d.ts.map