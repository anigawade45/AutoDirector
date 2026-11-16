import { analysisQueue, previewQueue, renderQueue } from '../queue/queueService.js';
import { StructuredLogger } from './logger.js';

export interface AlertNotification {
  alertType: 'QUEUE_BACKLOG' | 'REPEATED_FAILURES' | 'JOB_TIMEOUT' | 'UPSTREAM_LLM_DEGRADED';
  severity: 'warning' | 'critical';
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface MetricSummary {
  apiAvailabilityPct: number;
  totalRequests: number;
  totalErrors: number;
  queueDepths: {
    analysis: number;
    preview: number;
    render: number;
  };
  recentAlerts: AlertNotification[];
  planner?: {
    total: number;
    primary: number;
    fallbackModel: number;
    heuristic: number;
    consecutiveHeuristic: number;
  };
}

export class MetricsService {
  private static totalRequests = 0;
  private static totalErrors = 0;
  private static consecutiveFailures = 0;
  private static alertHistory: AlertNotification[] = [];

  // Planner execution observability counters
  private static plannerTotal = 0;
  private static plannerPrimary = 0;
  private static plannerFallbackModel = 0;
  private static plannerHeuristic = 0;
  private static consecutiveHeuristicFallbacks = 0;

  // Latency samples in milliseconds for p50/p95/p99 calculation
  private static latencySamples: number[] = [];

  /**
   * Records an AI planner execution, tracking model fallback and heuristic degradation.
   */
  static recordPlannerExecution(details: {
    provider: string;
    requestedModel: string;
    actualModel: string;
    executionMode: 'primary_llm' | 'fallback_llm' | 'heuristic_fallback';
    isFallback: boolean;
    fallbackReason?: string;
  }): void {
    this.plannerTotal++;
    if (details.executionMode === 'primary_llm') {
      this.plannerPrimary++;
      this.consecutiveHeuristicFallbacks = 0;
    } else if (details.executionMode === 'fallback_llm') {
      this.plannerFallbackModel++;
      this.consecutiveHeuristicFallbacks = 0;
    } else {
      this.plannerHeuristic++;
      this.consecutiveHeuristicFallbacks++;
      if (this.consecutiveHeuristicFallbacks >= 3) {
        this.triggerAlert({
          alertType: 'UPSTREAM_LLM_DEGRADED',
          severity: 'warning',
          message: `Detected ${this.consecutiveHeuristicFallbacks} consecutive heuristic fallbacks: Upstream LLM unavailable or failing`,
          timestamp: new Date().toISOString(),
          details: {
            requestedModel: details.requestedModel,
            actualModel: details.actualModel,
            fallbackReason: details.fallbackReason,
            consecutiveCount: this.consecutiveHeuristicFallbacks,
          },
        });
      }
    }
  }

  /**
   * Records an API request and its response status code.
   */
  static recordRequest(latencyMs: number, statusCode: number): void {
    this.totalRequests++;
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 5000) {
      this.latencySamples.shift();
    }

    if (statusCode >= 500) {
      this.totalErrors++;
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.triggerAlert({
          alertType: 'REPEATED_FAILURES',
          severity: 'critical',
          message: `Detected ${this.consecutiveFailures} consecutive 5xx server errors`,
          timestamp: new Date().toISOString(),
          details: { consecutiveFailures: this.consecutiveFailures, lastStatusCode: statusCode },
        });
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Inspects BullMQ queue depths and emits alerts if backlog exceeds threshold.
   */
  static async checkQueueDepths(backlogThreshold = 10): Promise<{
    analysis: number;
    preview: number;
    render: number;
  }> {
    const [analysisWaiting, previewWaiting, renderWaiting] = await Promise.all([
      analysisQueue.getWaitingCount().catch(() => 0),
      previewQueue.getWaitingCount().catch(() => 0),
      renderQueue.getWaitingCount().catch(() => 0),
    ]);

    const depths = {
      analysis: analysisWaiting,
      preview: previewWaiting,
      render: renderWaiting,
    };

    if (
      analysisWaiting > backlogThreshold ||
      previewWaiting > backlogThreshold ||
      renderWaiting > backlogThreshold
    ) {
      this.triggerAlert({
        alertType: 'QUEUE_BACKLOG',
        severity: 'warning',
        message: `Queue depth exceeded threshold of ${backlogThreshold} waiting jobs`,
        timestamp: new Date().toISOString(),
        details: depths,
      });
    }

    return depths;
  }

  /**
   * Triggers an alert notification and logs it with structured severity.
   */
  static triggerAlert(alert: AlertNotification): void {
    this.alertHistory.push(alert);
    if (this.alertHistory.length > 100) {
      this.alertHistory.shift();
    }

    StructuredLogger.warn(`[ALERT:${alert.alertType}] ${alert.message}`, {
      alertType: alert.alertType,
      severity: alert.severity,
      details: alert.details,
    });
  }

  /**
   * Fast synchronous accessor for planner telemetry without probing external queues.
   */
  static getPlannerSummary() {
    return {
      total: this.plannerTotal,
      primary: this.plannerPrimary,
      fallbackModel: this.plannerFallbackModel,
      heuristic: this.plannerHeuristic,
      consecutiveHeuristic: this.consecutiveHeuristicFallbacks,
    };
  }

  /**
   * Fast synchronous accessor for recent alert notifications.
   */
  static getRecentAlerts(): AlertNotification[] {
    return [...this.alertHistory];
  }

  /**
   * Computes p95 latency in milliseconds.
   */
  static calculateP95Latency(): number {
    if (this.latencySamples.length === 0) return 0;
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    return sorted[p95Index] || 0;
  }

  /**
   * Computes API availability percentage (default 100% when no errors).
   */
  static getAvailabilityPct(): number {
    if (this.totalRequests === 0) return 100.0;
    const successfulRequests = this.totalRequests - this.totalErrors;
    return Number(((successfulRequests / this.totalRequests) * 100).toFixed(2));
  }

  /**
   * Returns a complete metric summary snapshot.
   */
  static async getSummary(): Promise<MetricSummary> {
    const queueDepths = await this.checkQueueDepths().catch(() => ({
      analysis: 0,
      preview: 0,
      render: 0,
    }));

    return {
      apiAvailabilityPct: this.getAvailabilityPct(),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      queueDepths,
      recentAlerts: [...this.alertHistory],
      planner: {
        total: this.plannerTotal,
        primary: this.plannerPrimary,
        fallbackModel: this.plannerFallbackModel,
        heuristic: this.plannerHeuristic,
        consecutiveHeuristic: this.consecutiveHeuristicFallbacks,
      },
    };
  }

  /**
   * Resets internal metrics (useful between test runs).
   */
  static reset(): void {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.consecutiveFailures = 0;
    this.plannerTotal = 0;
    this.plannerPrimary = 0;
    this.plannerFallbackModel = 0;
    this.plannerHeuristic = 0;
    this.consecutiveHeuristicFallbacks = 0;
    this.latencySamples = [];
    this.alertHistory = [];
  }
}
