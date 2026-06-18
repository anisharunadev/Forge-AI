/**
 * Fastify server for the customer-cloud-broker (FORA-126 / 0.7.4).
 *
 * Routes:
 *   POST /broker/action       Broker a single ToolCall envelope
 *   POST /broker/probe        Re-probe a tenant's cloud trust
 *   GET  /healthz             Liveness
 *   GET  /readyz              Readiness (deny-list + trust store + audit sink healthy)
 *   GET  /metrics             Prometheus text exposition
 *
 * The broker is intentionally a *separate* service from the
 * identity-broker. Killing this broker halts all cloud-brokered
 * actions; the platform (and the identity-broker) keeps running —
 * the FORA-126 acceptance bar #5.
 */
import { type FastifyInstance } from 'fastify';
import { type BrokerDeps } from './broker.js';
import type { BrokerConfig } from './config.js';
export interface BuildServerDeps extends BrokerDeps {
    config: BrokerConfig;
}
export declare function buildServer(deps: BuildServerDeps): Promise<FastifyInstance>;
