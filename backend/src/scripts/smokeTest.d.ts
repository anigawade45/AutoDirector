interface SmokeCheckResult {
    name: string;
    status: 'PASSED' | 'FAILED' | 'SKIPPED';
    durationMs: number;
    message?: string;
}
export declare class ProductionSmokeTestSuite {
    private static results;
    static runAll(apiBaseUrl?: string): Promise<{
        success: boolean;
        total: number;
        passed: number;
        failed: number;
        results: SmokeCheckResult[];
    }>;
    private static checkHealthEndpoint;
    private static checkCatalogEndpoint;
    private static checkAuthEndpoints;
    private static checkS3Configuration;
    private static checkQueueHealth;
}
export {};
//# sourceMappingURL=smokeTest.d.ts.map