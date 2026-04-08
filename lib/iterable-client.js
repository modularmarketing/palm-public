'use strict';

/**
 * Shared Iterable API client.
 * Zero external dependencies. Uses Node.js v25 native fetch.
 *
 * Exports: iterableFetch, sleep, parseArgs
 */

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make a GET request to the Iterable API.
 *
 * Handles:
 *  - Auth header (Api-Key)
 *  - Array params (repeated keys via URLSearchParams.append)
 *  - 429 rate-limit: reads Retry-After header, sleeps, retries ONCE
 *  - 414 URI Too Long: throws so caller can halve batch size
 *  - Non-2xx: throws with status and statusText
 *
 * @param {string} path    - API path, e.g. '/api/campaigns'
 * @param {Object} params  - Query params. Array values are appended with repeated keys.
 * @param {string} apiKey  - Iterable API key
 * @param {string} baseUrl - Base URL, e.g. 'https://api.iterable.com'
 * @returns {Promise<Response>} - Raw Response object; caller parses body
 */
async function iterableFetch(path, params, apiKey, baseUrl) {
  const url = new URL(path, baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          url.searchParams.append(key, v);
        }
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 10;
    const sleepSeconds = retryAfter + 1;
    console.error(`[RATE_LIMITED] 429 received. Retry-After: ${retryAfter}s. Sleeping ${sleepSeconds}s before retry.`);
    await sleep(sleepSeconds * 1000);
    // Retry once
    const retryResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    if (!retryResponse.ok) {
      throw new Error(`Iterable API error after retry: ${retryResponse.status} ${retryResponse.statusText}`);
    }
    return retryResponse;
  }

  if (response.status === 414) {
    throw new Error(`Iterable API error 414: URI Too Long. Batch size is too large — reduce campaign ID batch size and retry.`);
  }

  if (!response.ok) {
    throw new Error(`Iterable API error: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Parse --key value argument pairs from process.argv.
 *
 * Required keys: api-key, base-url, output
 * Optional keys: start-date, end-date, window-index
 *
 * @param {string[]} argv - process.argv
 * @returns {Object} - Parsed arguments as { 'api-key': '...', 'base-url': '...', ... }
 * @throws {Error} - If a required key is missing
 */
function parseArgs(argv) {
  const args = {};
  const rawArgs = argv.slice(2); // Drop 'node' and script path

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = rawArgs[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith('--')) {
        args[key] = nextArg;
        i++; // Skip the value
      } else {
        args[key] = true; // Flag without value (e.g. --help)
      }
    }
  }

  // Validate required keys
  const required = ['api-key', 'base-url', 'output'];
  for (const key of required) {
    if (!args[key] || args[key] === true) {
      throw new Error(`Missing required argument: --${key}`);
    }
  }

  return args;
}

module.exports = { iterableFetch, sleep, parseArgs };
