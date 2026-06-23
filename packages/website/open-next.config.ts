import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Minimal OpenNext config — no incremental cache override. Add an R2/KV
// incremental cache here if the site starts using ISR/on-demand revalidation.
export default defineCloudflareConfig();
