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

import * as nats from 'nats';
import {NatsError, ConnectionOptions, ErrorCode, createInbox, MsgCallback, SubscriptionOptions, Sub as sub, Msg, SubEvent} from "nats"
export {NatsError, ConnectionOptions, ErrorCode, createInbox, MsgCallback, SubscriptionOptions, Msg, SubEvent} from "nats"
import {existsSync} from "fs";

// locate our package.json
let pkgFile = __dirname + './../package.json';
if (!existsSync(pkgFile)) {
    // tests will find it here
    pkgFile = __dirname + './../../package.json';
}
/** Version of the ts-nats library */
export const VERSION = require(pkgFile).version;


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

/** Argument provided to `serversChanged` event handlers. */
export interface ServersChangedEvent {
    /** Server URLs learned via cluster gossip */
    added: string[];
    /** Removed server URLs (only added servers are removed). */
    deleted: string[];
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
    (err: NatsError|null): void;
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
export interface NatsConnectionOptions extends ConnectionOptions  {}

/**
 * NATS server Client object.
 */
export class Client implements events.EventEmitter {
    nc!: nats.Client;
    /** Returns an unique and properly formatted inbox subject that can be used for replies */

    /** @hidden */
    constructor(nc: nats.Client) {
        this.nc = nc;
    }

    /** @hidden */
    static connect(opts?: ConnectionOptions | string | number): Promise<Client> {
        return new Promise((resolve, reject) => {
            const nc = nats.connect(opts as ConnectionOptions);
            let rr = false
            nc.on('error', (err) => {
                if (!rr) {
                    rr = true
                    reject(err)
                }
            });
            nc.once('connect', (nc) => {
                nc.removeAllListeners();
                const c = new Client(nc);
                c.nc = nc;
                rr = true
                resolve(c);
            });
        });
    }

    /**
     * Flush outbound queue to server and call optional callback when server has processed all data.
     * @param cb is optional. Flush is completed when promise resolves.
     * @return Promise<any>
     */
    flush(cb?: FlushCallback): Promise<any> {
        return new Promise((resolve, reject) => {
            this.nc?.flush((err) => {
                if (!err) {
                    resolve();
                } else {
                    reject(err);
                }
                if (cb) {
                    cb(err)
                }
            });
        });
    }

    /**
     * Publish a message to the given subject, with optional payload and reply subject.
     * @param subject
     * @param data optional (can be a string, JSON object, or Buffer. Must match [[ConnectionOptions.payload].)
     * @param reply optional
     */
    publish(subject: string, data: any = undefined, reply: string = ''): void {
        if (reply) {
            this.nc.publishRequest(subject, reply, data)
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
    subscribe(subject: string, cb: MsgCallback, opts: SubscriptionOptions = {}): Promise<Sub> {
        return new Promise<Sub>( (resolve, reject) => {
            if (typeof cb !== 'function') {
                reject(new NatsError('requests require a callback', ErrorCode.API_ERROR));
                return
            }
            const sub = this.nc.subscribe(subject, (err, _) => {
                if (err) {
                    reject(err)
                }
            }, opts);
            if (sub) {
                // @ts-ignore
                // swap the callback
                sub.callback = cb;
                resolve(new Sub(sub))
            }
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
            this.nc.drain((err) => {
                if (err) {
                    reject(err)
                } else {
                    resolve()
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
        return this.nc.closed === true ;
    }

    /**
     * Report number of subscriptions on this connection.
     *
     * @return {Number}
     */
    numSubscriptions(): number {
        return this.nc.numSubscriptions();
    }

    // implement event emitter, and proxy all events from the underlying nats connection
    addListener(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.addListener(event, listener);
        return this;
    }
    on(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.on(event, listener);
        return this;
    }
    once(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.once(event, listener);
        return this;
    }
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.removeListener(event, listener);
        return this;
    }
    off(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.off(event, listener);
        return this;
    }
    removeAllListeners(event?: string | symbol): this {
        this.nc.removeAllListeners(event);
        return this;
    }
    setMaxListeners(n: number): this {
        this.nc.setMaxListeners(n);
        return this;
    }
    getMaxListeners(): number {
        return this.nc.getMaxListeners();
    }
    listeners(event: string | symbol): Function[] {
        return this.nc.listeners(event)
    }
    rawListeners(event: string | symbol): Function[] {
        return this.nc.rawListeners(event);
    }
    emit(event: string | symbol, ...args: any[]): boolean {
        return this.nc.emit(event, args);
    }
    listenerCount(type: string | symbol): number {
        return this.nc.listenerCount(type);
    }
    prependListener(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.prependListener(event, listener);
        return this;
    }
    prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this {
        this.nc.prependOnceListener(event, listener);
        return this;
    }
    eventNames(): Array<string | symbol> {
        return this.nc.eventNames();
    }
}


/**
 * Creates a NATS [[Client]] by connecting to the specified server, port or using the specified [[ConnectionOptions]].
 * @param opts
 * @return Promise<Client>
 */
export function connect(opts?: NatsConnectionOptions | ConnectionOptions | string | number): Promise<Client> {
    return Client.connect(opts);
}

/**
 * Type returned when a subscribe call resolved. Provides methods to manage the subscription.
 */
export class Sub {
    sub: sub;
    /**
     * @hidden
     */
    constructor(sub: sub) {
        this.sub = sub;
    }

    /**
     * Cancels the subscription after the specified number of messages has been received.
     * If max is not specified, the subscription cancels immediately. A cancelled subscription
     * will not process messages that are inbound but not yet handled.
     * @param max
     * @see [[drain]]
     */
    unsubscribe(max?: number): void {
        this.sub.unsubscribe(max);
    }

    /**
     * Draining a subscription is similar to unsubscribe but inbound pending messages are
     * not discarded. When the last in-flight message is processed, the subscription handler
     * is removed.
     * @return a Promise that resolves when the draining a subscription completes
     * @see [[unsubscribe]]
     */
    drain(): Promise<any> {
        const sub = this.sub;
        return new Promise<any>((resolve, reject) => {
            sub.drain((err) => {
                if (err) {
                    reject(err)
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
        return this.sub.hasTimeout();
    }

    /**
     * Cancels a timeout associated with the subscription
     */
    cancelTimeout(): void {
        this.sub.cancelTimeout();
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
     * @param max - max number of messages
     */
    setTimeout(millis: number, max?: number): boolean {
        return this.sub.setTimeout(millis, max);
    }

    /**
     * Returns the number of messages received by the subscription.
     */
    getReceived(): number {
        return this.sub.getReceived();
    }

    /**
     * Returns the number of messages expected by the subscription.
     * If `0`, the subscription was not found or was auto-cancelled.
     * If `-1`, the subscription didn't specify a count for expected messages.
     */
    getMax(): number {
        return this.sub.getMax();
    }

    /**
     * @return true if the subscription is not found.
     */
    isCancelled(): boolean {
        return this.sub.isCancelled()
    }

    /**
     * @return true if the subscription is draining.
     * @see [[drain]]
     */
    isDraining(): boolean {
        return this.sub.isDraining()
    }

    getID(): number {
        return this.sub.getID()
    }
}

/**
 * @deprecated
 */
export class Subscription extends Sub {
    constructor(sub: sub) {
        super(sub);
    }
}