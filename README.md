# TypeScript NATS - Node.js Client

A TypeScript [Node.js](http://nodejs.org/) client for the [NATS messaging system](https://nats.io).

[![license](https://img.shields.io/github/license/nats-io/ts-nats.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Travis branch](https://img.shields.io/travis/nats-io/ts-nats/master.svg)]()
[![Coveralls github branch](https://img.shields.io/coveralls/github/nats-io/ts-nats/master.svg)](https://coveralls.io/github/nats-io/ts-nats)
[![npm](https://img.shields.io/npm/v/ts-nats.svg)](https://www.npmjs.com/package/ts-nats)
[![npm](https://img.shields.io/npm/dt/ts-nats.svg)](https://www.npmjs.com/package/ts-nats)

ts-nats is a typescript nats library for node that supports Promises and async/await patterns.
[Full documentation](https://nats-io.github.io/ts-nats/).

## Installation

```bash
npm install ts-nats
```

## Basic Usage

The starting point is the `connect()` function. You can give no arguments, a port, an URL or a
[`NatsConnectionOption`](https://nats-io.github.io/ts-nats/interfaces/_nats_.natsconnectionoptions.html) 
specifying detailed behaviour. Inside an async function, you can use async/await pattern.

```typescript
import {connect, NatsConnectionOptions, Payload} from 'ts-nats';

...
try {
    let nc = await connect({servers: ['nats://demo.nats.io:4222', 'tls://demo.nats.io:4443']});
    // Do something with the connection
} catch(ex) {
    // handle the error
}
...
```


Since `connect()` returns a Promise, the promise patterns are supported. With no arguments, it will attempt to connect to `nats://localhost:4222`
```typescript
connect()
    .then((nc) => {
        // Do something with the connection
    })
    .catch((ex) => {
        // handle the error
    });
    
```

Once you have a connection, you can publish data:
```typescript
nc.publish('greeting', 'hello world!');
```

Subscribing allows you to receive messages published on a subject:
```typescript
// simple subscription - subscribe returns a promise to a subscription object
let sub = await nc.subscribe('greeting', (err, msg) => {
    if(err) {
        // do something
    } else {
        // do something with msg.data
    }
});
```

Subscription can respond to the publisher if the publisher sets a reply subject:
```typescript
let service = await nc.subscribe('greeter', (err, msg) => {
    if(err) {
        // handle the error
    } else if (msg.reply) {
        nc.publish(msg.reply, `hello there ${msg.data}`);
    }
});

// create an unique subject just to receive a response message
let inbox = nc.createInbox();
let sub2 = await nc.subscribe(inbox, (err, msg) => {
    if(err) {
        // handle the error
    } else {
        console.log(msg.data);
    }
}, {max: 1});

// publish a 'request' message
nc.publish('greeter', "NATS", inbox)

// stop getting messages on the service subscription
service.unsubscribe();

// didn't have to specify unsubscribe for sub2, the `{max: 1}` auto unsubscribes
// when the first message is received.
```

The above pattern is called Request/Reply - because it is so pervasive, ts-nats makes
it very easy to make a request and handle a single response. The request API returns
a Promise to a response message. All the bookkeeping, creating an inbox subject,
creating a subscription to manage the response, and publishing details are handled 
by the call. Since requests are expected to have a response, they require a timeout. 
If the request does not receive a response within the specified timeout, the promise rejects.

Subscriptions to handle request responses are very efficient since they utilize a shared
subscription on the server. The client multiplexes the response without having to create
and destroy subscriptions server-side.

```typescript
let msg = await nc.request('greeter', 1000, 'me');
```

When done using a connection, closing it releases all resources, and cancels all
subscriptions.
```typescript
nc.close();
```


## Wildcard Subscriptions

A single subscription can can process related messages. When the subject
specifies wildcards tokens, those parts of the subject can match different things.
One of the wildcards is the `*` (asterisk). The asterisk in `foo.*.baz` matches 
all values in that token's position (`foo.bar.baz`, f`oo.a.baz`, ...). 

To work as a wildcard, the wildcard character must be the only character in the token.
 Asterisks that are part of a token value are interpreted as string literals,
`foo.a*.bar` and will only match the literal value of `foo.a*.bar`.

```typescript
let sub1 = await nc.subscribe('foo.*.baz', (err, msg) => {
    console.log('message received on', msg.subject, ":", msg.data);
});
```

Another wildcard is the `>` (greater than symbol). `>` tokens can only appear
as the last token in a subject. `foo.>` will match `foo.bar`, `foo.bar.baz`,
`foo.foo.bar.bax.22`. When part of a token it is interpreted as a string 
literal `foo.bar.a>` will only match `foo.bar.a>`. Subscribing to `>` will 
match all subjects.

```typescript
let sub2 = await nc.subscribe('foo.baz.>', (err, msg) => {
    console.log('message received on', msg.subject, ":", msg.data);
});

```
## Queue Groups

All subscriptions with the same queue name will form a queue group.
Each message will be delivered to only a single subscriber in the queue group.
You can have as many queue groups as you wish. Normal subscribers and different
queue groups are independent.
```typescript
let sub3 = await nc.subscribe('foo.baz.>', (err, msg) => {
    console.log('message received on', msg.subject, ":", msg.data);
}, {queue: 'A'});

```
## Clustered Usage

A NATS connection can specify several servers. When the NATS client connects to one of the
servers, the server may gossip additional known cluster members. If the NATS client
disconnects, it will attempt to connect to one of them.

```typescript
let servers = ['nats://demo.nats.io:4222', 'nats://127.0.0.1:5222', 'nats://127.0.0.1:6222'];
// Randomly connect to a server in the cluster group.
let nc2 = await connect({servers: servers});
```

The client will randomize the list of servers that it manages to prevent a __thundering herd__
of clients all at the same time trying to reconnect to the same server. To pervent randomization,
specify the `noRandomize` option.

```typescript
// Preserve order when connecting to servers.
let nc3 = await connect({servers: servers, noRandomize: true});
```
## TLS

Using a TLS connection encrypts all traffic to the client. Secure connections are easy with NATS.
Servers using TLS have the `tls` protocol instead of `nats`.

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

User credentials can be specified in the URL or as NatsConnectionOptions.

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

NATS typically buffers messages sent to the server to reduce the number of kernel calls.
This yields greater performance. The NATS client automatically buffers commands from the
client and sends them. This buffering behaviour also allows a NATS client to briefly
disconnect and continue publishing messages and creating subscriptions. On reconnect,
the client sends all buffered messages and subscriptions to the server.

Sometimes a client wants to make sure that outgoing messages have been processed by the NATS
server. The `flush()` will call you on an user provided callback when the round trip
to the server is done.

```typescript
// Flush the connection, and get notified when the server has finished processing
let ok = await nc.flush();

// or
nc.flush(() => {
    console.log('done');
});
```

A client can insure that when the processing of incoming messages takes longer
than some threshold, that time is given to other waiting IO tasks.
In the example below, when processing takes longer than 10ms, the client
will yield.

```typescript
let nc10 = await connect({port: PORT, yieldTime: 10});
```

Subscriptions can auto cancel after it has received some specified
number of messages:

```typescript
nc.subscribe('foo', (err, msg) => {
    // do something
}, {max: 10});
```

Or if the expected message count is not received to timeout:
```typescript
// Timeout if 10 messages are not received in specified time:
nc.subscribe('foo', (err, msg) => {
    // do something
}, {max: 10, timeout: 1000});
```

Timeouts and expected message counts can be specified via the
subscription after it the subscription resolves:

```typescript
let sub2 = await nc.subscribe('foo', (err, msg) => {
    // do something
});
sub2.unsubscribe(10);
sub2.setTimeout(1000);
```


Message payloads can be strings, binary, or json
Payloads determine the type of `msg.data` on subscriptions
`string`, `Buffer`, or `javascript object`.

```typescript
let nc12 = await connect({payload: Payload.STRING});
let nc13 = await connect({payload: Payload.JSON});
let nc14 = await connect({payload: Payload.BINARY});
```

String encodings can be set to node supported string encodings.
Default encoding is `utf-8`, it only affects string payloads.

```typescript
let nc14 = await connect({payload: Payload.STRING, encoding: "ascii"});
```

Connect and reconnect behaviours can be configured. You can specify the number
of attempts and the interval between attempts on reconnects. By default a NATS connection 
will try to reconnect to a server 10 times, waiting 2 seconds between reconnect attempts.
If the maximum number of retries is reached, the client will `close()` the connection.

```typescript
// Keep trying to reconnect forever, and attempt to reconnect every 250ms
let nc15 = await connect({maxReconnectAttempts: -1, reconnectTimeWait: 250});

```

## Notifications

The nats client is an `EventEmitter`, and thus emits various notifications:

| Event                  | Argument               | Description
|--------                |---------               |------------
| `close`                |                        | Emitted when the client closes. A closed client is finished, and cannot be reused.
| `connect`              | `Client`, url (string), `ServerInfo` | Emitted when the client first connects to a NATS server. Only happens once.
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
| `noEcho`               | `false`                   | If set, the client's matching subscriptions won't receive messages published by the client. Requires server support 1.2.0+.
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
We will support and build ts-nats on even Nodejs versions that are current 
or in maintenance.


## License

Unless otherwise noted, the NATS source files are distributed under the Apache Version 2.0 license found in the LICENSE file.
