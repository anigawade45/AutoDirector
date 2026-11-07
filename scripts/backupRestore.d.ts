export interface BackupVerificationResult {
    service: 'mongodb' | 'redis' | 's3';
    command: string;
    retentionPolicy: string;
    verificationStatus: 'VERIFIED' | 'FAILED';
    details: string;
}
export declare class BackupRestoreService {
    /**
     * Validates production backup & restore procedures, commands, and retention policies.
     */
    static verifyBackupProcedures(): {
        timestamp: string;
        allPassed: boolean;
        checks: BackupVerificationResult[];
    };
}
//# sourceMappingURL=backupRestore.d.ts.map