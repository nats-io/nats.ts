# NATS - Node.js Client

A [Node.js](http://nodejs.org/) client for the [NATS messaging system](https://nats.io).

[![license](https://img.shields.io/github/license/nats-io/ts-nats.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Travis branch](https://img.shields.io/travis/nats-io/ts-nats/master.svg)]()
[![Coveralls github branch](https://img.shields.io/coveralls/github/nats-io/ts-nats/master.svg)]()
[![npm](https://img.shields.io/npm/v/ts-nats.svg)](https://www.npmjs.com/package/nats)
[![npm](https://img.shields.io/npm/dt/ts-nats.svg)](https://www.npmjs.com/package/nats)

ts-nats is a typescript nats library for node that supports Promises and async/await patterns.
[Full documentation](https://nats-io.github.io/ts-nats/)

## Installation

```bash
npm install ts-nats
```

## Basic Usage
```typescript
import {connect, NatsConnectionOptions, Payload} from "ts-nats";

// connect takes a port, url or a NatsConnectionOptions options
// `connect()` returns a Promise to a NATS client
connect()
    .then((nc) => {
        // Do something with the connection
    })
    .catch((ex) => {
        // handle the error
    });
    

// alternatively, inside an async function
...
try {
    let nc = await connect({servers: ['nats://demo.nats.io:4222', 'nats://somehost:4443']});
    // Do something with the connection
} catch(ex) {
    // handle the error
}
...

// simple publisher
nc.publish('greeting', 'hello world!');

// simple subscription - subscribe returns a promise to a subscription object
let sub = await nc.subscribe('greeting', (err, msg) => {
    if(err) {
        // do something
    } else {
        // do something with msg.data
    }
});

// a subscription can respond to request messages:
let sub = await nc.subscribe('greeter', (err, msg) => {
    if(err) {
        // do something
    } else if (msg.reply) {
        nc.publish(msg.reply, `hello there ${msg.data}`);
    }
});

// stop getting messages on the subscription
sub.unsubscribe();

// request publishes a message with a reply subject, and creates a
// subscription to handle the first reply. Requests specify a timeout
// at which point the request will throw an error. Requests return
// a Promise to a message.
let msg = await nc.request('greeter', 1000, 'me');

// when the client is finished, the connection can be closed
nc.close();
```



## Wildcard Subscriptions

```typescript
// "*" matches all values in a token (foo.bar.baz, foo.a.baz, ...)
// to work as a regex it must be the only character in the token.
// Asterisks that are part of a token value are interpreted as string
// literals,`foo.a*.bar` and will only match the literal value of `foo.a*.bar`.
let sub1 = await nc.subscribe('foo.*.baz', (err, msg) => {
    console.log('message received on', msg.subject, ":", msg.data);
});


// ">" matches any length of the tail of a subject. It can only be
// the last token E.g. 'foo.>' will match 'foo.bar', 'foo.bar.baz',
// 'foo.foo.bar.bax.22'. If part of a token it is interpreted as a
// string literal `foo.bar.a>` will only match `foo.bar.a>`.
let sub2 = await nc.subscribe('foo.baz.>', (err, msg) => {
    console.log('message received on', msg.subject, ":", msg.data);
});

```
## Queue Groups

```typescript
// All subscriptions with the same queue name will form a queue group.
// Each message will be delivered to only a single subscriber in the queue group.
// You can have as many queue groups as you wish. Normal subscribers will continue 
// to work as expected.
let sub3 = await nc.subscribe('foo.baz.>', (err, msg) => {
    console.log('message received on', msg.subject, ":", msg.data);
}, {queue: 'A'});

```
## Clustered Usage

```typescript
let servers = ['nats://demo.nats.io:4222', 'nats://127.0.0.1:5222', 'nats://127.0.0.1:6222'];
// Randomly connect to a server in the cluster group.
let nc2 = await connect({servers: servers});


// Preserve order when connecting to servers.
let nc3 = await connect({servers: servers, noRandomize: true});
```
## TLS

```typescript
// Simple TLS connect
let ncs = await connect({url: 'tls://demo.nats.io:4443'});

// Client can explicitly request that the server be using tls
let ncs1 = await connect({url: 'tls://demo.nats.io:4443', tls: true});

// if CA is self signed:
import {readFileSync} from "fs";

let caCert = readFileSync('/path/to/cacert');
let ncs2 = await connect({url: 'tls://demo.nats.io:4443', tls: {
    ca: caCert
}});

// client can verify server certificate:
let ncs3 = await connect({url: 'tls://demo.nats.io:4443', tls: {
    ca: caCert,
    rejectUnauthorized: true
}});

// client can request to not validate server cert:
let ncs4 = await connect({url: 'tls://demo.nats.io:4443', tls: {
    rejectUnauthorized: false
}});

// if server requires client certificates
import {readFileSync} from "fs";
let caCert = readFileSync('/path/to/cacert');
let clientCert = readFileSync('/path/to/clientCert');
let clientKey = readFileSync('/path/to/clientKey');

let ncs5 = await connect({url: 'tls://someserver:4443', tls: {
    ca: caCert,
    key: clientKey,
    cert: clientCert
}});

```
## Authentication
```typescript
// Connect with username and password in the url
let nc6= await connect({url: 'nats://me:secret@127.0.0.1:4222'});
// Connect with username and password in the options
let nc7= await connect({url: 'nats://127.0.0.1:4222', user: 'me', pass: 'secret'});
// Connect with token in url
let nc8= await connect({url: 'nats://token@127.0.0.1:4222'});
// or token inside the options:
let nc9= await connect({url: 'nats://127.0.0.1:4222', token: 'token'});
```
## Advanced Usage

```javascript
// Flush the connection, and get notified when the server has finished processing
let ok = await nc.flush();

// or
nc.flush(() => {
    console.log('done');
});


// If you want to make sure NATS yields during the processing
// of messages, you can use an option to specify a yieldTime in ms.
// During the processing of the inbound stream, the client will yield
// if it spends more than yieldTime milliseconds processing.
let nc10 = await connect({port: PORT, yieldTime: 10});

// Auto-cancel a subscription after a specified message count:
nc.subscribe('foo', (err, msg) => {
    // do something
}, {max: 10});

// Timeout if 10 messages are not received in specified time:
nc.subscribe('foo', (err, msg) => {
    // do something
}, {max: 10, timeout: 1000});

// or
let sub2 = await nc.subscribe('foo', (err, msg) => {
    // do something
});
sub2.unsubscribe(10);
sub2.setTimeout(1000);

// Message Payloads can be strings, binary, or json
// Payloads determine the type of `msg.data` on subscriptions
// string, Buffer, or javascript object
let nc12 = await connect({payload: Payload.STRING});
let nc13 = await connect({payload: Payload.JSON});
let nc14 = await connect({payload: Payload.BINARY});

// String encodings can be set to node supported string encodings.
// Default encoding is "utf-8", it only affects string payloads.
let nc14 = await connect({payload: Payload.STRING, encoding: "ascii"});


// Reconnect Attempts and Time between reconnects

// By default a NATS connection will try to reconnect to a server 10 times
// waiting 2 seconds between reconnect attempts. If the maximum number of
// retries is reached, the client will close the connection.

// Keep trying to reconnect forever, and attempt to reconnect every 250ms
let nc15 = await connect({maxReconnectAttempts: -1, reconnectTimeWait: 250});

```

## Notifications

The nats client is an `EventEmitter`, and thus emits various notifications:

| Event                  | Argument               | Description
|--------                |---------               |------------
| `close`                |                        | Emitted when the client closes. A closed client is finished, and cannot be reused.
| `connect`              | `Client`, url (string) | Emitted when the client first connects to a NATS server. Only happens once.
| `connecting`           | url (string)           | Emitted when the client first attempts to connect to a server.
| `disconnect`           | url                    | Emitted when the client disconnects from a server.
| `error`                | `NatsError`            | Emitted when the client receives an error. If an error handler is not set, the node process will exit.
| `permissionError`      | `NatsError`            | Emitted when the server emits a permission error when subscribing or publishing to a subject that the client is not allowed to.
| `reconnect`            | `Client`, url (string) | Emitted when the server connects to a different server
| `reconnecting`         | url (string)           | Emitted when the server attempts to reconnect to a different server
| `serversChanged`       | `ServersChangedEvent`  | Emitted when the server gossips a list of other servers in the cluster. Only servers not specified in a connect list are deleted if they disapear.
| `subscribe`            | `SubEvent`             | Emitted when a subscription is created on the client
| `unsubscribe`          | `SubEvent`             | Emitted when a subscription is auto-unsubscribed
| `yield`                |                        | Emitted when the client's processing took longer than the specified yield option, and the client yielded.



See examples for more information.   

## Connect Options

The following is the list of connection options and default values.

| Option                 | Default                   | Description
|--------                |---------                  |------------
| `encoding`             | `"utf8"`                  | Encoding specified by the client to encode/decode data
| `maxPingOut`           | `2`                       | Max number of pings the client will allow unanswered before rasing a stale connection error
| `maxReconnectAttempts` | `10`                      | Sets the maximun number of reconnect attempts. The value of `-1` specifies no limit
| `name`                 |                           | Optional client name (useful for debugging a client on the server output `-DV`)
| `noRandomize`          | `false`                   | If set, the order of user-specified servers is randomized.
| `pass`                 |                           | Sets the password for a connection
| `payload`              | `Payload.STRING`          | Sets the payload type [`Payload.STRING`, `Payload.BINARY`, or `Payload.JSON`].
| `pedantic`             | `false`                   | Turns on strict subject format checks
| `pingInterval`         | `120000`                  | Number of milliseconds between client-sent pings
| `reconnect`            | `true`                    | If false server will not attempt reconnecting
| `reconnectTimeWait`    | `2000`                    | If disconnected, the client will wait the specified number of milliseconds between reconnect attempts
| `servers`              |                           | Array of connection `url`s
| `tls`                  | `false`                   | This property can be a boolean or an Object. If true the client requires a TLS connection. If false a non-tls connection is required.  The value can also be an object specifying TLS certificate data. The properties `ca`, `key`, `cert` should contain the certificate file data. `ca` should be provided for self-signed certificates. `key` and `cert` are required for client provided certificates. `rejectUnauthorized` if `true` validates server's credentials
| `token`                |                           | Sets a authorization token for a connection
| `url`                  | `"nats://localhost:4222"` | Connection url
| `user`                 |                           | Sets the username for a connection
| `verbose`              | `false`                   | Turns on `+OK` protocol acknowledgements
| `waitOnFirstConnect`   | `false`                   | If `true` the server will fall back to a reconnect mode if it fails its first connection attempt.
| `yieldTime`            |                           | If set and processing exceeds yieldTime, client will yield to IO callbacks before processing additional inbound messages 



## Supported Node Versions    

Support policy for Nodejs versions follows 
[Nodejs release support]( https://github.com/nodejs/Release).
We will support and build node-nats on even Nodejs versions that are current 
or in maintenance.


## License

Unless otherwise noted, the NATS source files are distributed under the Apache Version 2.0 license found in the LICENSE file.
