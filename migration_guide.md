# Nats.ts v2 Migration Guide

Version 2 of the nats.ts library changes the library by making it a wrapper of the `nats.js 2.0` library. This streamlines both APIs, and makes maintenance of the nats.ts library trivial, as the internal protocol implementation is not replicated.

The nats.ts library differs from nats.js library in that the nats.js library is a standard node library using callbacks and event listeners, wheather the nats.ts library returns promises for `connect`, `subscribe`, `request`, `flush` apis. 

While every attempt was made to keep `nats.ts` very close, some changes were required. Most of these changes, moved API and functionality in `nats.ts` to `nats.js`, and simply exposed it or wrapped it as required.

## Migration Guide

### `connect()`

The nats.ts library will never emit a `connect`	event, as this event is trapped internally as part of resolving the connection promise. 

### `flush()`

The flush callback used to optionally return a promise if no callback was provided. The new implementation simply resolves the flush promise.

### `subscribe()`

The `subscribe` API now returns a Promise<`Sub`>, instead of a `Promise<Subscription>`