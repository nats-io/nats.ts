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
import {ConnectionOptions} from 'tls';
import {ErrorCode, INVALID_ENCODING_MSG_PREFIX, NatsError} from './error';
import {createInbox, extend} from './util';
import {ProtocolHandler} from './protocolhandler';
import {
    DEFAULT_MAX_PING_OUT,
    DEFAULT_MAX_RECONNECT_ATTEMPTS,
    DEFAULT_PING_INTERVAL,
    DEFAULT_PRE,
    DEFAULT_RECONNECT_TIME_WAIT,
    DEFAULT_URI
} from './const';
import {next} from 'nuid';
import Timer = NodeJS.Timer;
import {existsSync} from "fs";

export {ErrorCode, NatsError}

/** Version of the ts-nats library */
export const VERSION = process.env.npm_package_version ?? require('../package.json').version;

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

/**
 * @hidden
 */
export function defaultSub(): Sub {
    return {sid: 0, subject: '', received: 0} as Sub;
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
    /** optional payload for the message. Type is controlled by [[NatsConnectionOptions.payload]]. */
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
    /** Specifies a string payload. This is default [[NatsConnectionOptions.payload]] setting */
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

/** [[Client.subscribe]] callbacks. First argument will be an error if an error occurred (such as a timeout) or null. Message argument is the received message (which should be treated as debug information when an error is provided). */
export interface MsgCallback {
    (err: NatsError | null, msg: Msg): void;
}

/** Signs a challenge from the server with an NKEY, a function matching this interface must be provided when manually signing nonces via the `nonceSigner` connect option. */
export interface NonceSigner {
    (nonce: string): Buffer;
}

/** Returns an user JWT - can be specified in `userJWT` connect option as a way of dynamically providing a JWT when required. */
export interface JWTProvider {
    (): string;
}

/** Additional options that can be provided to [[Client.subscribe]]. */
export interface SubscriptionOptions {
    /** Name of the queue group for the subscription */
    queue?: string;
    /** Maximum number of messages expected. When this number of messages is received the subscription auto [[Subscription.unsubscribe]]. */
    max?: number;
}

/** @hidden */
export interface RequestOptions {
    max?: number;
    timeout?: number;
}

export interface NatsConnectionOptions {
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
    /** Interval in milliseconds that the client will send PINGs to the server. See [[NatsConnectionOptions.maxPingOut]] */
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
    /** Returns an unique and properly formatted inbox subject that can be used for replies */
    createInbox = createInbox;
    private protocolHandler!: ProtocolHandler;

    /** @hidden */
    constructor() {
        super();
        events.EventEmitter.call(this);
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
    static connect(opts?: NatsConnectionOptions | string | number): Promise<Client> {
        return new Promise((resolve, reject) => {
            let options = Client.parseOptions(opts);
            let client = new Client();
            ProtocolHandler.connect(client, options)
                .then((ph) => {
                    client.protocolHandler = ph;
                    resolve(client);
                }).catch((ex) => {
                reject(ex);
            });
        });
    }

    /**
     * @hidden
     */
    private static defaultOptions(): ConnectionOptions {
        return {
            encoding: 'utf8',
            maxPingOut: DEFAULT_MAX_PING_OUT,
            maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
            noRandomize: false,
            pedantic: false,
            pingInterval: DEFAULT_PING_INTERVAL,
            reconnect: true,
            reconnectTimeWait: DEFAULT_RECONNECT_TIME_WAIT,
            tls: undefined,
            verbose: false,
            waitOnFirstConnect: false
        } as ConnectionOptions;
    }

    /**
     * @hidden
     */
    private static parseOptions(args?: string | number | NatsConnectionOptions): NatsConnectionOptions {
        if (args === undefined || args === null) {
            args = {url: DEFAULT_URI} as NatsConnectionOptions;
        }

        if (typeof args === 'number') {
            args = {url: DEFAULT_PRE + args} as NatsConnectionOptions;
        } else if (typeof args === 'string') {
            args = {url: args.toString()} as NatsConnectionOptions;
        } else if (typeof args === 'object') {
            if (args.port !== undefined) {
                args.url = DEFAULT_PRE + args.port;
            }
        }
        // override defaults with provided options.
        // non-standard aliases are not handled
        // FIXME: may need to add uri and pass
        // uri, password, urls, NoRandomize, dontRandomize, secure, client
        let options = extend(Client.defaultOptions(), args);

        // Authentication - make sure authentication is valid.
        if (options.user && options.token) {
            throw NatsError.errorForCode(ErrorCode.BAD_AUTHENTICATION);
        }

        // if specified nonceSigner must be a function
        if (options.nonceSigner && typeof options.nonceSigner !== 'function') {
            throw NatsError.errorForCode(ErrorCode.NONCE_SIGNER_NOTFUNC);
        }

        // Encoding - make sure its valid.
        let bufEncoding = options.encoding as BufferEncoding;
        if (!Buffer.isEncoding(bufEncoding)) {
            throw new NatsError(INVALID_ENCODING_MSG_PREFIX + options.encoding, ErrorCode.INVALID_ENCODING);
        }

        return options;
    }

    /**
     * Flush outbound queue to server and call optional callback when server has processed all data.
     * @param cb is optional, if not provided a Promise is returned. Flush is completed when promise resolves.
     * @return Promise<void> or void if a callback was provided.
     */
    flush(cb?: FlushCallback): Promise<void> | void {
        if (cb === undefined) {
            return new Promise((resolve, reject) => {
                this.protocolHandler.flush((err) => {
                    if (!err) {
                        resolve();
                    } else {
                        reject(err);
                    }
                });
            });
        } else {
            this.protocolHandler.flush(cb);
        }
    }

    /**
     * Publish a message to the given subject, with optional payload and reply subject.
     * @param subject
     * @param data optional (can be a string, JSON object, or Buffer. Must match [[NatsConnectionOptions.payload].)
     * @param reply optional
     */
    publish(subject: string, data: any = undefined, reply: string = ''): void {
        if (!subject) {
            throw NatsError.errorForCode(ErrorCode.BAD_SUBJECT);
        }
        this.protocolHandler.publish(subject, data, reply);
    }

    /**
     * Subscribe to a given subject. Messages are passed to the provided callback.
     * @param subject
     * @param cb
     * @param opts   Optional subscription options
     * @return Promise<Subscription>
     */
    subscribe(subject: string, cb: MsgCallback, opts: SubscriptionOptions = {}): Promise<Subscription> {
        return new Promise<Subscription>((resolve, reject) => {
            if (!subject) {
                reject(NatsError.errorForCode(ErrorCode.BAD_SUBJECT));
            }
            if (!cb) {
                reject(new NatsError('subscribe requires a callback', ErrorCode.API_ERROR));
            }

            let s = defaultSub();
            extend(s, opts);
            s.subject = subject;
            s.callback = cb;
            resolve(this.protocolHandler.subscribe(s));
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
        return this.protocolHandler.drain();
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
            if (this.isClosed()) {
                reject(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
            }
            if (!subject) {
                reject(NatsError.errorForCode(ErrorCode.BAD_SUBJECT));
            }

            let r = defaultReq();
            let opts = {max: 1} as RequestOptions;
            extend(r, opts);
            r.token = next();
            let request = this.protocolHandler.request(r);
            r.timeout = setTimeout(() => {
                request.cancel();
                reject(NatsError.errorForCode(ErrorCode.REQ_TIMEOUT));
            }, timeout);
            r.callback = (error: Error | null, msg?: Msg) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(msg);
                }
            };

            try {
                this.publish(subject, data, `${this.protocolHandler.muxSubscriptions.baseInbox}${r.token}`);
            } catch (err) {
                reject(err);
                request.cancel();
            }
        });
    };

    /**
     * Closes the connection to the NATS server. A closed client cannot be reconnected.
     */
    close(): void {
        this.protocolHandler.close();
    }

    /**
     * @return true if the NATS client is closed.
     */
    isClosed(): boolean {
        return this.protocolHandler.isClosed();
    }

    /**
     * Report number of subscriptions on this connection.
     *
     * @return {Number}
     */
    numSubscriptions(): number {
        return this.protocolHandler.numSubscriptions();
    }
}


/**
 * Creates a NATS [[Client]] by connecting to the specified server, port or using the specified [[NatsConnectionOptions]].
 * @param opts
 * @return Promise<Client>
 */
export function connect(opts?: NatsConnectionOptions | string | number): Promise<Client> {
    return Client.connect(opts);
}

/**
 * Type returned when a subscribe call resolved. Provides methods to manage the subscription.
 */
export class Subscription {
    sid: number;
    private protocol: ProtocolHandler;

    /**
     * @hidden
     */
    constructor(sub: Sub, protocol: ProtocolHandler) {
        this.sid = sub.sid;
        this.protocol = protocol;
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
        this.protocol.unsubscribe(this.sid, max);
    }

    /**
     * Draining a subscription is similar to unsubscribe but inbound pending messages are
     * not discarded. When the last in-flight message is processed, the subscription handler
     * is removed.
     * @return a Promise that resolves when the draining a subscription completes
     * @see [[unsubscribe]]
     */
    drain(): Promise<any> {
        return this.protocol.drainSubscription(this.sid);
    }

    /**
     * Returns true if the subscription has an associated timeout.
     */
    hasTimeout(): boolean {
        let sub = this.protocol.subscriptions.get(this.sid);
        return sub !== null && sub.hasOwnProperty('timeout');
    }

    /**
     * Cancels a timeout associated with the subscription
     */
    cancelTimeout(): void {
        let sub = this.protocol.subscriptions.get(this.sid);
        Subscription.cancelTimeout(sub);
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
        let sub = this.protocol.subscriptions.get(this.sid);
        Subscription.cancelTimeout(sub);
        if (sub) {
            sub.timeout = setTimeout(() => {
                if (sub && sub.callback) {
                    sub.callback(NatsError.errorForCode(ErrorCode.SUB_TIMEOUT), {} as Msg);
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
        let sub = this.protocol.subscriptions.get(this.sid);
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
        let sub = this.protocol.subscriptions.get(this.sid);
        if (!sub) {
            return 0;
        }
        if (sub && sub.max) {
            return sub.max;
        }
        return -1;
    }

    /**
     * @return true if the subscription is not found.
     */
    isCancelled(): boolean {
        return this.protocol.subscriptions.get(this.sid) === null;
    }

    /**
     * @return true if the subscription is draining.
     * @see [[drain]]
     */
    isDraining(): boolean {
        let sub = this.protocol.subscriptions.get(this.sid);
        if (sub) {
            return sub.draining === true;
        }
        return false;
    }
}
