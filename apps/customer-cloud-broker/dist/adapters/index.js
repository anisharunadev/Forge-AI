/**
 * Adapter index. The broker constructs a per-cloud adapter registry
 * at boot. Adding a new cloud is a one-line addition here once the
 * adapter itself lands.
 */
export function buildAdapterRegistry(opts) {
    const map = new Map();
    if (opts.aws)
        map.set('aws', opts.aws);
    if (opts.azure)
        map.set('azure', opts.azure);
    if (opts.gcp)
        map.set('gcp', opts.gcp);
    return {
        get(cloud) {
            return map.get(cloud);
        },
    };
}
