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


export const VERSION = '1.0.0';

const EMPTY = "";


export interface FlushCallback {
    (err?: NatsError): void;
}

export interface RequestCallback {
    (msg: string | Buffer | object, inbox?: string): void;
}

export interface SubscriptionCallback {
    (msg: any, inbox: string, subject: string, sid: number): void;
}

export interface TimeoutCallback {
    (sid: number): void;
}

export interface Subscription {
    subject: string;
    callback?: SubscriptionCallback | null;
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
    url: string;
    encoding?: BufferEncoding;
    json?: boolean;
    maxPingOut: number;
    maxReconnectAttempts: number;
    name?: string;
    noRandomize: boolean;
    pass?: string;
    pedantic?: boolean;
    pingInterval?: number;
    port?: number;
    preserveBuffers?: boolean;
    reconnect?: boolean;
    reconnectTimeWait?: number;
    servers?: Array<string>;
    tls?: boolean | tls.TlsOptions;
    token?: string;
    useOldRequestStyle?: boolean;
    user?: string;
    verbose?: boolean;
    waitOnFirstConnect?: boolean;
    yieldTime?: number;
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


    /**
     * Flush outbound queue to server and call optional callback when server has processed
     * all data.
     *
     * @param {Function} [cb]
     * @api public
     */
    flush(cb?: FlushCallback): void {
        this.protocolHandler.flush(cb);
    }

    /**
     * Publish a message to the given subject, with optional reply and callback.
     *
     * @param {String} subject
     * @param {String} [msg]
     * @param {String} [opt_reply]
     * @param {Function} [opt_callback]
     * @api public
     */
    publish(subject: string, msg?: any, opt_reply?: string, opt_callback?: FlushCallback): void {
        // They only supplied a callback function.
        if (typeof subject === 'function') {
            opt_callback = subject;
            subject = "";
        }
        if (!this.protocolHandler.options.json) {
            msg = msg || EMPTY;
        } else {
            // undefined is not a valid JSON-serializable value, but null is
            msg = msg === undefined ? null : msg;
        }
        if (!subject) {
            if (opt_callback) {
                opt_callback(NatsError.errorForCode(ErrorCode.BAD_SUBJECT));
            } else {
                throw (NatsError.errorForCode(ErrorCode.BAD_SUBJECT));
            }
        }
        if (typeof msg === 'function') {
            if (opt_callback || opt_reply) {
                let err = NatsError.errorForCode(ErrorCode.BAD_MSG);
                if (typeof opt_callback === 'function') {
                    opt_callback(err);
                    return;
                } else {
                    throw err;
                }
            }
            opt_callback = msg;
            msg = EMPTY;
            opt_reply = "";
        }
        if (typeof opt_reply === 'function') {
            if (opt_callback) {
                // function value for message - test is actually providing a callback
                opt_callback(NatsError.errorForCode(ErrorCode.BAD_REPLY));
                return;
            }
            opt_callback = opt_reply;
            opt_reply = "";
        }
        this.protocolHandler.publish(subject, msg, opt_reply, opt_callback);
    }

    /**
     * Subscribe to a given subject, with optional options and callback. opts can be
     * ommitted, even with a callback. The Subscriber Id is returned.
     *
     * @param {String} subject
     * @param {Object} [opts]
     * @param {Function} callback
     * @return {Number}
     * @api public
     */
    subscribe(subject: string, opts?: SubscribeOptions, callback?: SubscriptionCallback): number {
        if (typeof opts === 'function') {
            callback = opts;
            opts = {} as SubscribeOptions;
        }
        return this.protocolHandler.subscribe(subject, opts as SubscribeOptions, callback);
    }

    /**
     * Unsubscribe to a given Subscriber Id, with optional max parameter.
     * Unsubscribing to a subscription that already yielded the specified number of messages
     * will clear any pending timeout callbacks.
     *
     * @param {Number} sid
     * @param {Number} [opt_max]
     * @api public
     */
    unsubscribe(sid: number, opt_max?: number) {
        this.protocolHandler.unsubscribe(sid, opt_max);
    };

    // /**
    //  * Set a timeout on a subscription. The subscription is cancelled if the
    //  * expected number of messages is reached or the timeout is reached.
    //  * If this function is called with an SID from a multiplexed
    //  * request call, the original timeout handler associated with the multiplexed
    //  * request is replaced with the one provided to this function.
    //  *
    //  * @param {Number} sid
    //  * @param {Number} timeout
    //  * @param {Number} expected
    //  * @param {Function} callback
    //  * @api public
    //  */
    // timeout(sid: number, timeout: number, expected: number, callback: TimeoutCallback): void {
    //     if (!sid) {
    //         return;
    //     }
    //     let sub = null;
    //     // check the sid is not a mux sid - which is always negative
    //     if (sid < 0) {
    //         if (this.muxSubscriptions) {
    //             let conf = this.muxSubscriptions.getMuxRequestConfig(sid);
    //             if (conf && conf.timeout) {
    //                 // clear auto-set timeout
    //                 clearTimeout(conf.timeout);
    //             }
    //             sub = conf;
    //         }
    //     } else if (this.subs) {
    //         sub = this.subs[sid];
    //     }
    //
    //     if (sub) {
    //         sub.expected = expected;
    //         sub.timeout = setTimeout(() => {
    //             callback(sid);
    //             // if callback fails unsubscribe will leak
    //             this.unsubscribe(sid);
    //         }, timeout);
    //     }
    // }


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
     * @param {String} [opt_msg]
     * @param {Object} [opt_options]
     * @param {Number} timeout
     * @param {Function} callback - can be called with message or NatsError if the request timed out.
     * @return {Number}
     * @api public
     */
    request(subject: string, opt_msg: string | Buffer | object, opt_options: RequestOptions, timeout: number, callback: RequestCallback): void {
        if (typeof opt_msg === 'number') {
            if (typeof opt_options === 'function') {
                callback = opt_options;
            }
            timeout = opt_msg;
            //@ts-ignore
            opt_options = undefined;
            opt_msg = EMPTY;
        }

        if (typeof opt_options === 'number') {
            if (typeof timeout === 'function') {
                callback = timeout;
            }
            timeout = opt_options;
            //@ts-ignore
            opt_options = undefined;
        }

        opt_options = opt_options || {};
        opt_options.max = 1;
        opt_options.timeout = timeout;
        this.protocolHandler.request(subject, opt_msg, opt_options, callback);
    };

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