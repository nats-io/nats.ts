/*
 * Copyright 2013-2018 The NATS Authors
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
 */

import events = require('events');
import tls = require('tls');
import Timer = NodeJS.Timer;
import {ErrorCode, INVALID_ENCODING_MSG_PREFIX, NatsError} from "./error";
import {createInbox, extend} from "./util";
import {ProtocolHandler} from "./protocolhandler";
import {
    DEFAULT_MAX_PING_OUT,
    DEFAULT_MAX_RECONNECT_ATTEMPTS,
    DEFAULT_PING_INTERVAL,
    DEFAULT_PRE,
    DEFAULT_RECONNECT_TIME_WAIT,
    DEFAULT_URI
} from "./const";

import {ConnectionOptions} from "tls";
import {Callback} from "./transport";
import {next} from 'nuid';

export const VERSION = ProtocolHandler.VERSION;

export interface Base {
    subject: string;
    callback: MsgCallback;
    received: number;
    timeout?: Timer;
    max?: number | undefined;
}

export function defaultSub(): Sub {
    return {sid: 0, subject: "", received: 0} as Sub;
}

export interface Sub extends Base {
    sid: number;
    queueGroup?: string | null;
}

export interface Req extends Base {
    token: string;
}


export interface Msg {
    subject: string;
    reply?: string;
    data: string | Buffer | object;
    sid: number;
    size: number;
}

export enum Payload {
    STRING = "string",
    JSON = "json",
    BINARY = "binary"
}

export interface FlushCallback {
    (err: NatsError | null): void;
}

export interface MsgCallback {
    (err: NatsError | null, msg?: Msg): void;
}

export interface Subscription {
    subject: string;
    callback?: MsgCallback | null;
    received: number;
    qgroup: string;
    timeout?: Timer | null;
    max?: number;
    expected?: number;
}

export interface SubscribeOptions {
    queue?: string;
    max?: number;
}

export interface RequestOptions {
    max?: number;
    timeout?: number;
}

export interface NatsConnectionOptions {
    encoding?: BufferEncoding;
    maxPingOut: number;
    maxReconnectAttempts: number;
    name?: string;
    noRandomize: boolean;
    pass?: string;
    payload?: Payload;
    pedantic?: boolean;
    pingInterval?: number;
    port?: number;
    preserveBuffers?: boolean;
    reconnect?: boolean;
    reconnectTimeWait?: number;
    servers?: Array<string>;
    tls?: boolean | tls.TlsOptions;
    token?: string;
    url: string;
    useOldRequestStyle?: boolean;
    user?: string;
    verbose?: boolean;
    waitOnFirstConnect?: boolean;
    yieldTime?: number;
}

function defaultReq(): Req {
    return {token: "", subject: "", received: 0, max: 1} as Req;
}

export class Client extends events.EventEmitter {
    /**
     * Allow createInbox to be called on a client.
     *
     * @api public
     */
    createInbox = createInbox;
    private protocolHandler!: ProtocolHandler;

    constructor() {
        super();
        events.EventEmitter.call(this);
    }

    static connect(opts?: NatsConnectionOptions | number | string | void): Promise<Client> {
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

    private static defaultOptions(): ConnectionOptions {
        return {
            encoding: "utf8",
            maxPingOut: DEFAULT_MAX_PING_OUT,
            maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
            noRandomize: false,
            pedantic: false,
            pingInterval: DEFAULT_PING_INTERVAL,
            reconnect: true,
            reconnectTimeWait: DEFAULT_RECONNECT_TIME_WAIT,
            tls: false,
            useOldRequestStyle: false,
            verbose: false,
            waitOnFirstConnect: false,
        } as ConnectionOptions
    }

    private static parseOptions(args?: string | number | NatsConnectionOptions | void): NatsConnectionOptions {
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
            throw (NatsError.errorForCode(ErrorCode.BAD_AUTHENTICATION));
        }

        // Encoding - make sure its valid.
        let bufEncoding = options.encoding as BufferEncoding;
        if (!Buffer.isEncoding(bufEncoding)) {
            throw new NatsError(INVALID_ENCODING_MSG_PREFIX + options.encoding, ErrorCode.INVALID_ENCODING);
        }

        return options;
    }

    /**
     * Flush outbound queue to server and call optional callback when server has processed
     * all data.
     *
     * @param {Function} [cb]
     * @api public
     */
    flush(cb?: FlushCallback): Promise<void> | void {
        if (cb === undefined) {
            return new Promise((resolve) => {
                this.protocolHandler.flush(() => {
                    resolve();
                });
            });
        } else {
            this.protocolHandler.flush(cb);
        }
    }

    /**
     * Publish a message to the given subject, with optional reply and callback.
     *
     * @param {String} subject
     * @param {String} [data]
     * @param {String} [reply]
     * @param {Function} [opt_callback]
     * @api public
     * @throws NatsError - if the subject is missing
     */
    publish(subject: string, data: any = undefined, reply: string = ""): void {
        if (!subject) {
            throw NatsError.errorForCode(ErrorCode.BAD_SUBJECT);
        }

        this.protocolHandler.publish(subject, data, reply);
    }

    /**
     * Subscribe to a given subject, with optional options and callback. opts can be
     * ommitted, even with a callback. The Subscriber Id is returned.
     *
     * @param {String} subject
     * @param {Function} cb?
     * @param {Object} [opts?]
     * @return {Number}
     * @api public
     */
    subscribe(subject: string, cb: MsgCallback, opts: SubscribeOptions = {}): Promise<Subscription> {
        return new Promise<Subscription>((resolve, reject) => {
            if (this.isClosed()) {
                reject(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
            }
            if (!cb) {
                reject(new NatsError("subscribe requires a callback", ErrorCode.API_ERROR));
            }

            let s = defaultSub();
            extend(s, opts);
            s.subject = subject;
            s.callback = cb;
            resolve(this.protocolHandler.subscribe(s));
        });
    }


    /**
     * Publish a message with an implicit inbox listener as the reply. Message is optional.
     * This should be treated as a subscription. The subscription is auto-cancelled after the
     * first reply is received or the timeout in millisecond is reached.
     *
     * If a timeout is reached, the callback is invoked with a NatsError with it's code set to
     * `REQ_TIMEOUT` on the first argument of the callback function, and the subscription is
     * cancelled.
     *
     * The Subscriber Id is returned.
     *
     * @param {String} subject
     * @param {Number} timeout
     * @param {any} [data]
     * @return {Promise<Msg>}
     * @api public
     */
    request(subject: string, timeout: number = 1000, data: any = undefined): Promise<Msg> {
        return new Promise<Msg>((resolve, reject) => {
            if (this.isClosed()) {
                reject(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
            }

            let r = defaultReq();
            let opts = {max: 1} as RequestOptions;
            extend(r, opts);
            r.token = next();
            //@ts-ignore
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

            let request = this.protocolHandler.request(r);
            this.publish(subject, data, `${this.protocolHandler.muxSubscriptions.baseInbox}${r.token}`);
        });
    };

    close(): void {
        this.protocolHandler.close();
    }

    isClosed(): boolean {
        return this.protocolHandler.isClosed();
    }

    /**
     * Report number of outstanding subscriptions on this connection.
     *
     * @return {Number}
     * @api public
     */
    numSubscriptions(): number {
        return this.protocolHandler.numSubscriptions();
    }
}


/**
 * Connect to a nats-server and return the client.
 * Argument can be a url, or an object with a 'url'
 * property and additional options.
 *
 * @params {Mixed} [opts]
 *
 * @api public
 */
export function connect(opts?: NatsConnectionOptions | number | string): Promise<Client> {
    return Client.connect(opts);
}


export class Subscription {
    sid: number;
    private protocol: ProtocolHandler;

    constructor(sub: Sub, protocol: ProtocolHandler) {
        this.sid = sub.sid;
        this.protocol = protocol;
    }

    static cancelTimeout(s: Sub | null): void {
        if (s && s.timeout) {
            clearTimeout(s.timeout);
            delete s.timeout;
        }
    }

    unsubscribe(max?: number): void {
        this.protocol.unsubscribe(this.sid, max);
    }

    hasTimeout(): boolean {
        let sub = this.protocol.subscriptions.get(this.sid);
        return sub !== null && sub.timeout !== null;
    }

    cancelTimeout(): void {
        let sub = this.protocol.subscriptions.get(this.sid);
        Subscription.cancelTimeout(sub);
    }

    setTimeout(millis: number, cb: Callback): boolean {
        let sub = this.protocol.subscriptions.get(this.sid);
        Subscription.cancelTimeout(sub);
        if (sub) {
            sub.timeout = setTimeout(cb, millis);
            return true;
        }
        return false;
    }

    getReceived(): number {
        let sub = this.protocol.subscriptions.get(this.sid);
        if (sub) {
            return sub.received;
        }
        return 0;
    }
}