# NATS.ts - Async Node.js Client

**NATS.ts async functionality is now part of NATS.js**

NATS.ts provided async functionality the original NATS.js client.

The async functionality of nats.ts has been is now built-in right into
[NATS.js 2.0](https://github.com/nats-io/nats.js). NATS.js 2.0, greatly expands
on the async functionality provided by NATS.ts; for example subscriptions are
message iterators, etc.

While the API has changed, moving to the new API should be fairly simple. The
new API is a complete re-write and offers a common API for all our JavaScript
environments (Node.js, Browser, Deno). For more information please visit
https://github.com/nats-io/nats.js.
