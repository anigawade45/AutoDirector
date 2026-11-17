import mongoose from 'mongoose';
import { env } from '../config/env.js';

export interface ReplicaSetMemberInfo {
  id: number;
  name: string;
  stateStr: string;
  health: number;
}

export interface ReplicaSetValidationResult {
  success: boolean;
  setName: string;
  primary: string | null;
  members: ReplicaSetMemberInfo[];
  transactionsSupported: boolean;
  message: string;
}

export interface ValidateReplicaSetOptions {
  mongoUri?: string;
  expectedReplSetName?: string;
  expectedMemberHost?: string;
  prohibitLocalhostFromContainer?: boolean;
  timeoutMs?: number;
  mockDbAdmin?: any;
  mockSession?: any;
}

/**
 * Validates MongoDB replica set topology, primary host resolution, and ACID transaction readiness (POT-009).
 * Detects whether the replica set is advertising 'localhost:27017' in container topologies,
 * which causes non-host clients and worker/app containers on the Docker bridge network to fail connection discovery.
 */
export class MongoReplicaSetValidator {
  static async validate(
    options: ValidateReplicaSetOptions = {}
  ): Promise<ReplicaSetValidationResult> {
    const uri = options.mongoUri || env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_video_dev';
    const expectedReplSetName = options.expectedReplSetName || 'rs0';
    const timeoutMs = options.timeoutMs ?? 5000;

    // Support dependency injection for unit testing without live MongoDB daemon
    if (options.mockDbAdmin) {
      try {
        const status = await options.mockDbAdmin.command({ replSetGetStatus: 1 });
        const setName = status?.set || '';
        const members: ReplicaSetMemberInfo[] = (status?.members || []).map((m: any) => ({
          id: m._id,
          name: m.name,
          stateStr: m.stateStr,
          health: m.health,
        }));

        const primaryMember = members.find((m) => m.stateStr === 'PRIMARY');
        const primaryHost = primaryMember?.name || null;

        if (expectedReplSetName && setName !== expectedReplSetName) {
          return {
            success: false,
            setName,
            primary: primaryHost,
            members,
            transactionsSupported: false,
            message: `Replica set name mismatch: expected '${expectedReplSetName}', got '${setName}'`,
          };
        }

        if (options.expectedMemberHost && primaryHost) {
          if (!primaryHost.startsWith(options.expectedMemberHost)) {
            return {
              success: false,
              setName,
              primary: primaryHost,
              members,
              transactionsSupported: false,
              message: `Primary member host '${primaryHost}' does not match expected '${options.expectedMemberHost}'`,
            };
          }
        }

        if (options.prohibitLocalhostFromContainer && primaryHost?.includes('localhost:')) {
          return {
            success: false,
            setName,
            primary: primaryHost,
            members,
            transactionsSupported: false,
            message: `POT-009 Detected: Primary member host advertised as '${primaryHost}' in networked context. Other containers cannot resolve 'localhost'. Use service hostname (e.g. 'mongodb:27017').`,
          };
        }

        let transactionsSupported = false;
        if (options.mockSession) {
          try {
            options.mockSession.startTransaction();
            options.mockSession.abortTransaction();
            transactionsSupported = true;
          } catch {
            transactionsSupported = false;
          }
        } else {
          transactionsSupported = true;
        }

        return {
          success: true,
          setName,
          primary: primaryHost,
          members,
          transactionsSupported,
          message: `Replica set '${setName}' healthy (Primary: ${primaryHost}, ${members.length} member(s), Transactions: ${transactionsSupported ? 'supported' : 'unsupported'})`,
        };
      } catch (err: any) {
        return {
          success: false,
          setName: '',
          primary: null,
          members: [],
          transactionsSupported: false,
          message: `MongoDB server is not running as a replica set: ${err.message || String(err)}`,
        };
      }
    }

    let connection: any = null;
    let ownConnection = false;

    try {
      if (mongoose.connection.readyState === 1 && !options.mongoUri) {
        connection = mongoose.connection;
      } else {
        const client = await mongoose.createConnection(uri, {
          serverSelectionTimeoutMS: timeoutMs,
          connectTimeoutMS: timeoutMs,
        }).asPromise();
        connection = client;
        ownConnection = true;
      }

      const adminDb = connection.db.admin();
      let status: any;
      try {
        status = await adminDb.command({ replSetGetStatus: 1 });
      } catch (err: any) {
        return {
          success: false,
          setName: '',
          primary: null,
          members: [],
          transactionsSupported: false,
          message: `MongoDB server is not running as a replica set: ${err.message || String(err)}`,
        };
      }

      const setName = status?.set || '';
      const members: ReplicaSetMemberInfo[] = (status?.members || []).map((m: any) => ({
        id: m._id,
        name: m.name,
        stateStr: m.stateStr,
        health: m.health,
      }));

      const primaryMember = members.find((m) => m.stateStr === 'PRIMARY');
      const primaryHost = primaryMember?.name || null;

      if (expectedReplSetName && setName !== expectedReplSetName) {
        return {
          success: false,
          setName,
          primary: primaryHost,
          members,
          transactionsSupported: false,
          message: `Replica set name mismatch: expected '${expectedReplSetName}', got '${setName}'`,
        };
      }

      if (options.expectedMemberHost && primaryHost) {
        if (!primaryHost.startsWith(options.expectedMemberHost)) {
          return {
            success: false,
            setName,
            primary: primaryHost,
            members,
            transactionsSupported: false,
            message: `Primary member host '${primaryHost}' does not match expected '${options.expectedMemberHost}'`,
          };
        }
      }

      if (options.prohibitLocalhostFromContainer && primaryHost?.includes('localhost:')) {
        return {
          success: false,
          setName,
          primary: primaryHost,
          members,
          transactionsSupported: false,
          message: `POT-009 Detected: Primary member host advertised as '${primaryHost}' in networked context. Other containers cannot resolve 'localhost'. Use service hostname (e.g. 'mongodb:27017').`,
        };
      }

      let transactionsSupported = false;
      try {
        const session = await connection.startSession();
        session.startTransaction();
        await session.abortTransaction();
        await session.endSession();
        transactionsSupported = true;
      } catch {
        transactionsSupported = false;
      }

      return {
        success: true,
        setName,
        primary: primaryHost,
        members,
        transactionsSupported,
        message: `Replica set '${setName}' healthy (Primary: ${primaryHost}, ${members.length} member(s), Transactions: ${transactionsSupported ? 'supported' : 'unsupported'})`,
      };
    } catch (err: any) {
      return {
        success: false,
        setName: '',
        primary: null,
        members: [],
        transactionsSupported: false,
        message: `Failed to connect or validate replica set: ${err.message || String(err)}`,
      };
    } finally {
      if (ownConnection && connection) {
        try {
          await connection.close();
        } catch {}
      }
    }
  }
}

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  process.argv[1]?.endsWith('validateMongoReplicaSet.ts') ||
  process.argv[1]?.endsWith('validateMongoReplicaSet.js')
);

if (isDirectEntry) {
  const customUri = process.argv[2];
  const expectedHost = process.argv[3];
  MongoReplicaSetValidator.validate({
    mongoUri: customUri,
    expectedMemberHost: expectedHost,
    prohibitLocalhostFromContainer: process.env.CONTAINER_MODE === 'true',
  })
    .then((result) => {
      console.log(`\n================ MONGO REPLICA SET VALIDATION ================`);
      console.log(`Status: ${result.success ? 'PASSED' : 'FAILED'}`);
      console.log(`Set Name: ${result.setName || 'N/A'}`);
      console.log(`Primary Host: ${result.primary || 'N/A'}`);
      console.log(`Transactions Supported: ${result.transactionsSupported}`);
      console.log(`Details: ${result.message}`);
      console.log(`==============================================================\n`);
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[ReplicaSetValidator] Fatal error during execution:', err);
      process.exit(1);
    });
}
