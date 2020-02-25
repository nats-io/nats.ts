/*
 * Copyright 2018-2020 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import * as events from 'events';
import * as tls from 'tls';
import {existsSync} from "fs";
import Timer = NodeJS.Timer;

import * as nats from 'nats'
import {NatsError, ConnectionOptions, ErrorCode, createInbox, MsgCallback, SubscriptionOptions, Callback, version} from "nats"
export {NatsError, ConnectionOptions, ErrorCode, createInbox, MsgCallback, SubscriptionOptions} from "nats"

export const VERSION = version;

/**
 * @hidden
 */
export interface Base {
    subject: string;
    callback: MsgCallback;
    received: number;
    timeout?: Timer;
    max?: number | undefined;
    draining?: boolean;
}


/** ServerInfo received from the server */
export interface ServerInfo {
    tls_required?: boolean;
    tls_verify?: boolean;
    connect_urls?: string[];
    max_payload: number;
    client_id: number;
    proto: number;
    server_id: string;
    version: string;
    echo?: boolean;
    nonce?: string;
    nkey?: string;
}

/** Argument provided to `subscribe` and `unsubscribe` event handlers. */
export interface SubEvent {
    /** subscription subject */
    subject: string;
    /** subscription id */
    sid: number;
    /** subscription queue name if a queue subscription */
    queue?: string;
}

/** Argument provided to `serversChanged` event handlers. */
export interface ServersChangedEvent {
    /** Server URLs learned via cluster gossip */
    added: string[];
    /** Removed server URLs (only added servers are removed). */
    deleted: string[];
}

export interface Base {
    subject: string;
    callback: MsgCallback;
    received: number;
    timeout?: Timer;
    max?: number | undefined;
    draining?: boolean;
}


/**
 * @hidden
 */
export interface Sub extends Base {
    sid: number;
    queue?: string | null;
}

/**
 * @hidden
 */
export interface Req extends Base {
    token: string;
}

/**
 * Message object provided to subscription and requests.
 */
export interface Msg {
    /** subject used to publish the message */
    subject: string;
    /** optional reply subject where replies may be sent. */
    reply?: string;
    /** optional payload for the message. Type is controlled by [[ConnectionOptions.payload]]. */
    data?: any;
    /** Internal subscription id */
    sid: number;
    /** Number of bytes in the payload */
    size: number;
}

/**
 * Payload specifies the type of [[Msg.data]] that will be sent and received by the client.
 * The payload affects all client subscribers and publishers. If using mixed types, either
 * create multiple connections, or select [[Payload.BINARY]] and perform your own decoding.
 */
export enum Payload {
    /** Specifies a string payload. This is default [[ConnectionOptions.payload]] setting */
    STRING = 'string',
    /** Specifies payloads are JSON. */
    JSON = 'json',
    /** Specifies payloads are binary (Buffer) */
    BINARY = 'binary'
}

/** Optional callback interface for 'connect' and 'reconnect' events */
export interface ConnectReconnectCallback {
    (connection: Client, serverURL: string, info: ServerInfo): void
}

/** Optional callback interface for 'disconnect' and 'reconnecting' events */
export interface ReconnectingDisconnectCallback {
    (serverURL: string): void
}

/** Optional callback interface for 'permissionError' events */
export interface PermissionsErrorCallback {
    (err: NatsError): void
}

/** Optional callback for 'serversChanged' events */
export interface ServersChangedCallback {
    (e: ServersChangedEvent): void;
}

/** Optional callback for 'subscribe' and 'unsubscribe' events */
export interface SubscribeUnsubscribeCallback {
    (e: SubEvent): void
}

/** Optional callback for 'yield'events */
export interface YieldCallback {
    (): void
}

/** Optional callback argument for [[Client.flush]] */
export interface FlushCallback {
    (err?: NatsError): void;
}


/** Signs a challenge from the server with an NKEY, a function matching this interface must be provided when manually signing nonces via the `nonceSigner` connect option. */
export interface NonceSigner {
    (nonce: string): Buffer;
}

/** Returns an user JWT - can be specified in `userJWT` connect option as a way of dynamically providing a JWT when required. */
export interface JWTProvider {
    (): string;
}


/**
 * @deprecated - use ConnectionOptions
 */
export interface NatsConnectionOptions   {
    /** Requires server support 1.2.0+. When set to `true`, the server will not forward messages published by the client
     * to the client's subscriptions. By default value is ignored unless it is set to `true` explicitly */
    noEcho?: boolean;
    /** Sets the encoding type used when dealing with [[Payload.STRING]] messages. Only node-supported encoding allowed. */
    encoding?: BufferEncoding;
    /** Maximum number of client PINGs that can be outstanding before the connection is considered stale. */
    maxPingOut?: number;
    /** Maximum number of consecutive reconnect attempts before the client closes the connection. Specify `-1` to retry forever. */
    maxReconnectAttempts?: number;
    /** A name for the client. Useful for identifying a client on the server monitoring and logs. */
    name?: string;
    /** When `true` does not randomize the order of servers provided to connect. */
    noRandomize?: boolean;
    /** User password. */
    pass?: string;
    /** Specifies the payload type of the message. See [[Payload]]. Payload determines [[Msg.data]] types and types published. */
    payload?: Payload;
    /** @hidden */
    pedantic?: boolean;
    /** Interval in milliseconds that the client will send PINGs to the server. See [[ConnectionOptions.maxPingOut]] */
    pingInterval?: number;
    /** Specifies the port on the localhost to make a connection. */
    port?: number;
    /** Specifies whether the client should attempt reconnects. */
    reconnect?: boolean;
    /** Specifies the interval in milliseconds between reconnect attempts. */
    reconnectTimeWait?: number;
    /** A list of server URLs where the client should attempt a connection. */
    servers?: Array<string>;
    /** If true, or set as a tls.TlsOption object, requires the connection to be secure. Fine grain tls settings, such as certificates can be specified by using a tls.TlsOptions object. */
    tls?: boolean | tls.TlsOptions;
    /** Token to use for authentication. */
    token?: string;
    /** Server URL where the client should attempt a connection */
    url?: string;
    /** NATS username. */
    user?: string;
    /** @hidden */
    verbose?: boolean;
    /** If true, the client will perform reconnect logic if it fails to connect when first started. Normal behaviour is for the client to try the supplied list of servers and close if none succeed. */
    waitOnFirstConnect?: boolean;
    /** Specifies the max amount of time the client is allowed to process inbound messages before yielding for other IO tasks. When exceeded the client will yield. */
    yieldTime?: number;
    /** Nonce signer - a function that signs the nonce challenge sent by the server. */
    nonceSigner?: NonceSigner;
    /** Public NKey Identifying the user. */
    nkey?: string;
    /** A JWT identifying the user. Can be a static JWT string, or a function that returns a JWT when called. */
    userJWT?: string | JWTProvider;
    /** Credentials file path - will automatically setup an `nkey` and `nonceSigner` that references the specified credentials file.*/
    userCreds?: string;
    /** nkey file path - will automatically setup an `nkey` and `nonceSigner` that references the specified nkey seed file.*/
    nkeyCreds?: string;
    /** number of milliseconds when making a connection to wait for the connection to succeed. Must be greater than zero. */
    timeout?:number
}

/** @hidden */
function defaultReq(): Req {
    return {token: '', subject: '', received: 0, max: 1} as Req;
}

/**
 * NATS server Client object.
 */
export class Client extends events.EventEmitter {
    nc!: nats.Client;
    /** Returns an unique and properly formatted inbox subject that can be used for replies */

    /** @hidden */
    constructor(nc: nats.Client) {
        super();
        events.EventEmitter.call(this);
        this.nc = nc;
        // this.addDebugHandlers()
    }

    // private addDebugHandlers() {
    //     let events = [
    //         'close',
    //         'connect',
    //         'connecting',
    //         'disconnect',
    //         'error',
    //         'permissionError',
    //         'pingcount',
    //         'pingtimer',
    //         'reconnect',
    //         'reconnecting',
    //         'serversChanged',
    //         'subscribe',
    //         'unsubscribe',
    //         'yield',
    //     ];
    //
    //     function handler(name: string) {
    //         return function(arg: any) {
    //             console.log('debughdlr', name, [arg]);
    //         }
    //     }
    //
    //     events.forEach((e) => {
    //         this.on(e, handler(e));
    //     });
    // }

    /** @hidden */
    static connect(opts?: ConnectionOptions | string | number): Promise<Client> {
        return new Promise((resolve, reject) => {
            const nc = nats.connect(opts as ConnectionOptions);
            nc.once('connect', (nc) => {
                const c = new Client(nc);
                c.nc = nc;
                resolve(c);
            });
        });
    }

    /**
     * Flush outbound queue to server and call optional callback when server has processed all data.
     * @param cb is optional, if not provided a Promise is returned. Flush is completed when promise resolves.
     * @return Promise<void> or void if a callback was provided.
     */
    flush(cb?: FlushCallback): Promise<void> | void {
        if (cb === undefined) {
            return new Promise((resolve, reject) => {
                this.nc?.flush((err) => {
                    if (!err) {
                        resolve();
                    } else {
                        reject();
                    }
                });
            });
        } else {
            this.nc.flush(cb as Callback);
        }
    }

    /**
     * Publish a message to the given subject, with optional payload and reply subject.
     * @param subject
     * @param data optional (can be a string, JSON object, or Buffer. Must match [[ConnectionOptions.payload].)
     * @param reply optional
     */
    publish(subject: string, data: any = undefined, reply: string = ''): void {
        if (reply) {
            this.nc.publishRequest(subject, data, reply)
        } else {
            this.nc.publish(subject, data);
        }
    }

    /**
     * Subscribe to a given subject. Messages are passed to the provided callback.
     * @param subject
     * @param cb
     * @param opts   Optional subscription options
     * @return Promise<Subscription>
     */
    subscribe(subject: string, cb: MsgCallback, opts: SubscriptionOptions = {}): Promise<Subscription> {
        const client = this;
        return new Promise<Subscription>((resolve, reject) => {
            const sid = this.nc.subscribe(subject, (err, m) => {
                // @ts-ignore
                cb(err, m);
            }, opts);
            resolve(new Subscription(sid, client));
        });
    }

    /**
     * Drains all subscriptions. Returns a Promise that when resolved, indicates that all subscriptions have finished,
     * and the client closed. Note that after calling drain, it is impossible to create new
     * subscriptions or make any requests. As soon as all messages for the draining subscriptions are processed,
     * it is also impossible to publish new messages.
     * A drained connection is closed when the Promise resolves.
     * @see [[Subscription.drain]]
     */
    drain(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.nc?.drain((err) => {
                if (!err) {
                    resolve();
                } else {
                    reject();
                }
            });
        });
    }


    /**
     * Publish a request message with an implicit inbox listener as the reply. Message is optional.
     * This should be treated as a subscription. The subscription is auto-cancelled after the
     * first reply is received or the timeout in millisecond is reached.
     *
     * If a timeout is reached, the promise is rejected. Returns the received message if resolved.
     *
     * @param subject
     * @param timeout
     * @param data optional (can be a string, JSON object, or Buffer. Must match specified Payload option)
     * @return Promise<Msg>
     */
    request(subject: string, timeout: number = 1000, data: any = undefined): Promise<Msg> {
        return new Promise<Msg>((resolve, reject) => {
            this.nc.request(subject, (err, m) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(m as Msg)
                }
            }, data, {timeout: timeout});
        });
    };

    /**
     * Closes the connection to the NATS server. A closed client cannot be reconnected.
     */
    close(): void {
        this.nc.close();
    }

    /**
     * @return true if the NATS client is closed.
     */
    isClosed(): boolean {
        // @ts-ignore
        return this.nc.closed ;
    }

    /**
     * Report number of subscriptions on this connection.
     *
     * @return {Number}
     */
    numSubscriptions(): number {
        return this.nc.numSubscriptions();
    }
}


/**
 * Creates a NATS [[Client]] by connecting to the specified server, port or using the specified [[ConnectionOptions]].
 * @param opts
 * @return Promise<Client>
 */
export function connect(opts?: ConnectionOptions | ConnectionOptions | string | number): Promise<Client> {
    return Client.connect(opts);
}

/**
 * Type returned when a subscribe call resolved. Provides methods to manage the subscription.
 */
export class Subscription {
    client: Client;
    sid: number;
    /**
     * @hidden
     */
    constructor(sid: number, client: Client) {
        this.sid = sid;
        this.client = client;
    }

    /**
     * @hidden
     */
    static cancelTimeout(s: Sub | null): void {
        if (s && s.timeout) {
            clearTimeout(s.timeout);
            delete s.timeout;
        }
    }

    /**
     * Cancels the subscription after the specified number of messages has been received.
     * If max is not specified, the subscription cancels immediately. A cancelled subscription
     * will not process messages that are inbound but not yet handled.
     * @param max
     * @see [[drain]]
     */
    unsubscribe(max?: number): void {
        this.client.nc.unsubscribe(this.sid, max);
    }

    /**
     * Draining a subscription is similar to unsubscribe but inbound pending messages are
     * not discarded. When the last in-flight message is processed, the subscription handler
     * is removed.
     * @return a Promise that resolves when the draining a subscription completes
     * @see [[unsubscribe]]
     */
    drain(): Promise<any> {
        const client = this.client;
        return new Promise<any>((resolve, reject) => {
            client.nc.drainSubscription(this.sid, (err, sid) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(true)
                }
            });
        })
    }

    /**
     * Returns true if the subscription has an associated timeout.
     */
    hasTimeout(): boolean {
        if (this.sid > 0) {
            // @ts-ignore
            const s = this.client.nc.subs[sid];
            return s.timeout !== undefined;
        } else {
            // FIXME: requests timeout verification
            return false
        }
    }

    /**
     * Cancels a timeout associated with the subscription
     */
    cancelTimeout(): void {
        if (this.sid > 0) {
            // @ts-ignore
            const s = this.client.nc.subs[sid];
            if (s && s.timeout) {
                clearTimeout(s.timeout);
            }
        } else {
            // FIXME: requests timeout verification
        }
    }

    /**
     * Sets a timeout on a subscription. The timeout will fire by calling
     * the subscription's callback with an error argument if the expected
     * number of messages (specified via max) has not been received by the
     * subscription before the timer expires. If max is not specified,
     * the subscription times out if no messages are received within the timeout
     * specified.
     *
     * Returns `true` if the subscription was found and the timeout was registered.
     *
     * @param millis
     */
    setTimeout(millis: number): boolean {
        this.cancelTimeout();
        //@ts-ignore
        let sub = this.client.nc.subs[this.sid];
        if (sub) {
            sub.timeout = setTimeout(() => {
                if (sub.callback) {
                    const mc = sub.callback as MsgCallback;
                    mc(new NatsError(ErrorCode.TIMEOUT_ERR, ErrorCode.TIMEOUT_ERR), {} as Msg);
                }
                this.unsubscribe();
            }, millis);
            return true;
        }
        return false;
    }

    /**
     * Returns the number of messages received by the subscription.
     */
    getReceived(): number {
        // @ts-ignore
        let sub = this.client.nc.subs[this.sid];
        if (sub) {
            return sub.received;
        }
        return 0;
    }

    /**
     * Returns the number of messages expected by the subscription.
     * If `0`, the subscription was not found or was auto-cancelled.
     * If `-1`, the subscription didn't specify a count for expected messages.
     */
    getMax(): number {
        // @ts-ignore
        let sub = this.client.nc.subs[this.sid];
        if (sub) {
            return sub.max;
        }
        return -1;
    }

    /**
     * @return true if the subscription is not found.
     */
    isCancelled(): boolean {
        // @ts-ignore
        return this.client.nc.subs[this.sid] === undefined;
    }

    /**
     * @return true if the subscription is draining.
     * @see [[drain]]
     */
    isDraining(): boolean {
        // @ts-ignore
        let sub = this.client.nc.subs[this.sid]
        if (sub) {
            return sub.draining === true;
        }
        return false;
    }
}
