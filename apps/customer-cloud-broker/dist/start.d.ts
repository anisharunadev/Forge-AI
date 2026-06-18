/**
 * Service entrypoint. Wires the config, deny-list, trust store,
 * adapters, audit sink, metrics, and probe scheduler, then starts
 * the Fastify server.
 */
export declare function start(): Promise<void>;
