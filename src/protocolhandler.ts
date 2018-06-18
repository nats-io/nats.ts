/*
 * Copyright 2018 The NATS Authors
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

import {
    Client, FlushCallback, NatsConnectionOptions, RequestCallback, RequestOptions,
    SubscribeOptions, Subscription, SubscriptionCallback, VERSION
} from "./nats";
import {MuxSubscriptions} from "./muxsubscriptions";
import {Transport, TransportHandlers} from "./transport";
import {Payload, ServerInfo} from "./types";
import {CONN_ERR_PREFIX, ErrorCode, INVALID_ENCODING_MSG_PREFIX, NatsError, REQ_TIMEOUT_MSG_PREFIX} from "./error";
import Timer = NodeJS.Timer;
import url = require('url');

import {EventEmitter} from "events";
import {
    DEFAULT_MAX_PING_OUT,
    DEFAULT_MAX_RECONNECT_ATTEMPTS,
    DEFAULT_PING_INTERVAL, DEFAULT_PRE,
    DEFAULT_RECONNECT_TIME_WAIT, DEFAULT_URI
} from "./const";
import {Server, Servers} from "./servers";
import {TCPTransport} from "./tcptransport";

const PERMISSIONS_ERR = "permissions violation";
const STALE_CONNECTION_ERR = "stale connection";


const MAX_CONTROL_LINE_SIZE = 1024,

    // Protocol
    //CONTROL_LINE = /^(.*)\r\n/, // TODO: remove / never used

    MSG = /^MSG\s+([^\s\r\n]+)\s+([^\s\r\n]+)\s+(([^\s\r\n]+)[^\S\r\n]+)?(\d+)\r\n/i,
    OK = /^\+OK\s*\r\n/i,
    ERR = /^-ERR\s+('.+')?\r\n/i,
    PING = /^PING\r\n/i,
    PONG = /^PONG\r\n/i,
    INFO = /^INFO\s+([^\r\n]+)\r\n/i,
    SUBRE = /^SUB\s+([^\r\n]+)\r\n/i,

    CR_LF = '\r\n',
    CR_LF_LEN = CR_LF.length,
    EMPTY = '',
    SPC = ' ',

    // Protocol
    //PUB     = 'PUB', // TODO: remove / never used
    SUB = 'SUB',
    UNSUB = 'UNSUB',
    CONNECT = 'CONNECT',

    // Responses
    PING_REQUEST = 'PING' + CR_LF,
    PONG_RESPONSE = 'PONG' + CR_LF,

    // Pedantic Mode support
    //Q_SUB = /^([^\.\*>\s]+|>$|\*)(\.([^\.\*>\s]+|>$|\*))*$/, // TODO: remove / never used
    //Q_SUB_NO_WC = /^([^\.\*>\s]+)(\.([^\.\*>\s]+))*$/, // TODO: remove / never used

    FLUSH_THRESHOLD = 65536;

// Parser state
enum ParserState {
    CLOSED = -1,
    AWAITING_CONTROL = 0,
    AWAITING_MSG_PAYLOAD = 1
}

export class ProtocolHandler extends EventEmitter {
    private client: Client;
    private closed: boolean = false;
    private connected: boolean = false;
    private inbound!: Buffer | null;
    private info: ServerInfo = {} as ServerInfo;
    private infoReceived: boolean = false;
    private muxSubscriptions?: MuxSubscriptions;
    private payload?: Payload | null;
    private pBufs: boolean = false;
    private pending: any[] | null = [];
    private pingTimer?: Timer;
    private pongs: any[] | null = [];
    private pout: number = 0;
    private pSize: number = 0;
    private pstate: ParserState = ParserState.CLOSED;
    private reconnecting: boolean = false;
    private reconnects: number = 0;
    private ssid: number = 1;
    private subs: { [key: number]: Subscription } | null = {};
    private transport: Transport;
    private wasConnected: boolean = false;
    private currentServer!: Server;
    private servers: Servers;

    private pass?: string;
    private token?: string;
    private url!: url.UrlObject;
    private user?: string;

    encoding?: BufferEncoding;
    options: NatsConnectionOptions;

    constructor(client: Client, options: NatsConnectionOptions) {
        super();
        EventEmitter.call(this);

        this.client = client;
        this.options = options;

        // Set user/pass/token as needed if in options.
        this.user = options.user;
        this.pass = options.pass;
        this.token = options.token;

        this.servers = new Servers(!this.options.noRandomize, this.options.servers || [], this.options.url);
        this.transport = new TCPTransport(this.getTransportHandlers());
    }

    static connect(client: Client, opts: NatsConnectionOptions): Promise<ProtocolHandler> {
        return new Promise<ProtocolHandler>((resolve, reject) => {
            let ph = new ProtocolHandler(client, opts);
            ph.connect()
                .then(()=> {
                    resolve(ph);
                })
                .catch((ex)=>{
                    reject(ex);
                });
        });
    }

    private connect() : Promise<Transport> {
        this.prepareConnection();
        return this.transport.connect(this.url);
    }


    flush(cb?: FlushCallback): void {
        if (this.closed) {
            if (typeof cb === 'function') {
                cb(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
                return;
            } else {
                throw (NatsError.errorForCode(ErrorCode.CONN_CLOSED));
            }
        }
        if (this.pongs) {
            this.pongs.push(cb);
            this.sendCommand(PING_REQUEST);
            this.flushPending();
        }
    }

    private flushPending(): void {
        if (this.connected === false ||
            this.pending === null ||
            this.pending.length === 0 ||
            this.infoReceived !== true ||
            !this.transport.isConnected()) {
            return;
        }

        let client = this;
        let write = function (data: string | Buffer): void {
            if (!client.transport) {
                return;
            }
            client.pending = [];
            client.pSize = 0;
            client.transport.write(data);
        };

        if (!this.pBufs) {
            // All strings, fastest for now.
            write(this.pending.join(EMPTY));
            return
        } else {
            if (this.pending) {
                // We have some or all Buffers. Figure out if we can optimize.
                let allBuffs = true;
                for (let i = 0; i < this.pending.length; i++) {
                    if (!Buffer.isBuffer(this.pending[i])) {
                        allBuffs = false;
                        break;
                    }
                }

                // If all buffers, concat together and write once.
                if (allBuffs) {
                    return write(Buffer.concat(this.pending, this.pSize));
                } else {
                    // We have a mix, so write each one individually.
                    let pending = this.pending;
                    this.pending = [];
                    this.pSize = 0;
                    for (let i = 0; i < pending.length; i++) {
                        this.transport.write(pending[i]);
                    }
                    return;
                }
            }
        }
    }

    /**
     * Send commands to the server or queue them up if connection pending.
     *
     * @api private
     */
    private sendCommand(cmd: string | Buffer): void {
        // Buffer to cut down on system calls, increase throughput.
        // When receive gets faster, should make this Buffer based..

        if (this.closed || this.pending === null) {
            return;
        }

        this.pending.push(cmd);
        if (!Buffer.isBuffer(cmd)) {
            this.pSize += Buffer.byteLength(cmd);
        } else {
            this.pSize += cmd.length;
            this.pBufs = true;
        }

        if (this.connected === true) {
            // First one let's setup flush..
            if (this.pending.length === 1) {
                let self = this;
                setImmediate(function () {
                    self.flushPending();
                });
            } else if (this.pSize > FLUSH_THRESHOLD) {
                // Flush in place when threshold reached..
                this.flushPending();
            }
        }
    }


    /**
     * Close the connection to the server.
     *
     * @api public
     */
    close(): void {
        if (this.pingTimer) {
            clearTimeout(this.pingTimer);
            delete this.pingTimer;
        }
        this.closed = true;
        this.removeAllListeners();
        this.closeStream();
        this.ssid = -1;
        this.subs = null;
        this.pstate = ParserState.CLOSED;
        this.pongs = null;
        this.pending = null;
        this.pSize = 0;
    };

    publish(subject: string, msg?: any, opt_reply?: string, opt_callback?: FlushCallback): void {
        // Hold PUB SUB [REPLY]
        let psub;
        if (opt_reply === undefined) {
            psub = 'PUB ' + subject + SPC;
        } else {
            psub = 'PUB ' + subject + SPC + opt_reply + SPC;
        }

        // Need to treat sending buffers different.
        if (!Buffer.isBuffer(msg)) {
            let str = msg;
            if (this.options.json) {
                try {
                    str = JSON.stringify(msg);
                } catch (e) {
                    throw (NatsError.errorForCode(ErrorCode.BAD_JSON));
                }
            }
            this.sendCommand(psub + Buffer.byteLength(str) + CR_LF + str + CR_LF);
        } else {
            let b = Buffer.allocUnsafe(psub.length + msg.length + (2 * CR_LF_LEN) + msg.length.toString().length);
            let len = b.write(psub + msg.length + CR_LF);
            msg.copy(b, len);
            b.write(CR_LF, len + msg.length);
            this.sendCommand(b);
        }

        if (opt_callback !== undefined) {
            this.flush(opt_callback);
        } else if (this.closed) {
            throw (NatsError.errorForCode(ErrorCode.CONN_CLOSED));
        }
    }

    subscribe(subject: string, opts: SubscribeOptions, callback?: SubscriptionCallback): number {
        if (this.closed) {
            throw (NatsError.errorForCode(ErrorCode.CONN_CLOSED));
        }

        this.subs = this.subs || [];
        this.ssid += 1;
        this.subs[this.ssid] = {
            subject: subject,
            callback: callback,
            received: 0
        } as Subscription;

        let proto;
        if (typeof opts.queue === 'string') {
            this.subs[this.ssid].qgroup = opts.queue;
            proto = [SUB, subject, opts.queue, this.ssid + CR_LF];
        } else {
            proto = [SUB, subject, this.ssid + CR_LF];
        }

        this.sendCommand(proto.join(SPC));
        this.emit('subscribe', this.ssid, subject, opts);

        if (opts.max) {
            this.unsubscribe(this.ssid, opts.max);
        }
        return this.ssid;
    }

    unsubscribe(sid: number, opt_max?: number) {
        if (!sid || this.closed) {
            return;
        }

        // in the case of new muxRequest, it is possible they want perform
        // an unsubscribe with the returned 'sid'. Intercept that and clear
        // the request configuration. Mux requests are always negative numbers
        if (sid < 0) {
            if (this.muxSubscriptions) {
                this.muxSubscriptions.cancelMuxRequest(sid);
            }
            return;
        }

        let proto;
        if (opt_max) {
            proto = [UNSUB, sid, opt_max + CR_LF];
        } else {
            proto = [UNSUB, sid + CR_LF];
        }
        this.sendCommand(proto.join(SPC));

        this.subs = this.subs || [];
        let sub = this.subs[sid];
        if (sub === undefined) {
            return;
        }
        sub.max = opt_max;
        if (sub.max === undefined || (sub.received >= sub.max)) {
            // remove any timeouts that may be pending
            if (sub.timeout) {
                clearTimeout(sub.timeout);
                sub.timeout = null;
            }
            delete this.subs[sid];
            this.emit('unsubscribe', sid, sub.subject);
        }
    }

    /**
     * Publish a message with an implicit inbox listener as the reply. Message is optional.
     * This should be treated as a subscription. You can optionally indicate how many
     * messages you only want to receive using opt_options = {max:N}. Otherwise you
     * will need to unsubscribe to stop the message stream.
     *
     * You can also optionally specify the number of milliseconds to wait for the messages
     * to receive using opt_options = {timeout: N}. When the number of messages specified
     * is received before a timeout, the subscription auto-cancels. If the number of messages
     * is not specified, it is the responsibility of the client to unsubscribe to prevent
     * a timeout.
     *
     * The Subscriber Id is returned.
     *
     * @param {String} subject
     * @param {String} [opt_msg]
     * @param {Object} [opt_options]
     * @param {Function} [callback]
     * @return {Number}
     * @api public
     */
    request(subject: string, opt_msg?: string | Buffer | object, opt_options?: RequestOptions, callback?: RequestCallback): number {
        if (typeof opt_msg === 'function') {
            callback = opt_msg;
            opt_msg = EMPTY;
            opt_options = undefined;
        }
        if (typeof opt_options === 'function') {
            callback = opt_options;
            opt_options = undefined;
        }

        opt_options = opt_options || {} as RequestOptions;
        if(!this.muxSubscriptions) {
            this.muxSubscriptions = new MuxSubscriptions(this.client);
        }
        let conf = this.muxSubscriptions.initMuxRequestDetails(callback, opt_options.max);
        this.publish(subject, opt_msg, conf.inbox);

        if (opt_options.timeout) {
            conf.timeout = setTimeout(() => {
                if (conf.callback) {
                    conf.callback(new NatsError(REQ_TIMEOUT_MSG_PREFIX + conf.id, ErrorCode.REQ_TIMEOUT));
                }
                if (this.muxSubscriptions) {
                    this.muxSubscriptions.cancelMuxRequest(conf.token);
                }
            }, opt_options.timeout);
        }

        return conf.id;
    }


    /**
     * Properly setup a stream event handlers.
     *
     * @api private
     */
    private getTransportHandlers(): TransportHandlers {
        let client = this;
        let handlers = {} as TransportHandlers;
        handlers.connect = () => {
            if (client.pingTimer) {
                clearTimeout(client.pingTimer);
                delete client.pingTimer;
            }
            client.connected = true;
            client.scheduleHeartbeat();
        };

        handlers.close = () => {
            client.closeStream();
            client.emit('disconnect');
            if (client.closed === true ||
                client.options.reconnect === false ||
                ((client.reconnects >= client.options.maxReconnectAttempts) && client.options.maxReconnectAttempts !== -1)) {
                client.emit('close');
            } else {
                client.scheduleReconnect();
            }
        };

        handlers.error = (exception: Error) => {
            // If we were connected just return, close event will process
            if (client.wasConnected === true && client.currentServer.didConnect === true) {
                return;
            }

            // if the current server did not connect at all, and we in
            // general have not connected to any server, remove it from
            // this list. Unless overidden
            if (client.wasConnected === false && client.currentServer.didConnect === false) {
                // We can override this behavior with waitOnFirstConnect, which will
                // treat it like a reconnect scenario.
                if (client.options.waitOnFirstConnect) {
                    // Pretend to move us into a reconnect state.
                    client.currentServer.didConnect = true;
                } else {
                    client.servers.removeCurrentServer();
                }
            }

            // Only bubble up error if we never had connected
            // to the server and we only have one.
            if (client.wasConnected === false && client.servers.length() === 0) {
                client.emit('error', new NatsError(CONN_ERR_PREFIX + exception, ErrorCode.CONN_ERR, exception));
            }
            client.closeStream();
        };

        handlers.data = (data: Buffer) => {
            // If inbound exists, concat them together. We try to avoid this for split
            // messages, so this should only really happen for a split control line.
            // Long term answer is hand rolled parser and not regexp.
            if (client.inbound) {
                client.inbound = Buffer.concat([client.inbound, data]);
            } else {
                client.inbound = data;
            }

            // Process the inbound queue.
            client.processInbound();
        };

        return handlers;
    }

    /**
     * Send the connect command. This needs to happen after receiving the first
     * INFO message and after TLS is established if necessary.
     *
     * @api private
     */
    private sendConnect(): void {
        // Queue the connect command.
        let cs: { [key: string]: any } = {
            'lang': 'node',
            'version': VERSION,
            'verbose': this.options.verbose,
            'pedantic': this.options.pedantic,
            'protocol': 1
        };
        if (this.options.user !== undefined) {
            cs.user = this.options.user;
            cs.pass = this.options.pass;
        }
        if (this.options.token !== undefined) {
            cs.auth_token = this.options.token;
        }
        if (this.options.name !== undefined) {
            cs.name = this.options.name;
        }
        // If we enqueued requests before we received INFO from the server, or we
        // reconnected, there be other data pending, write this immediately instead
        // of adding it to the queue.
        this.transport.write(CONNECT + SPC + JSON.stringify(cs) + CR_LF);
    }

    /**
     * Properly setup a stream connection with proper events.
     *
     * @api private
     */
    private prepareConnection(): void {
        // Commands may have been queued during reconnect. Discard everything except:
        // 1) ping requests with a pong callback
        // 2) publish requests
        //
        // Rationale: CONNECT and SUBs are written directly upon connecting, any PONG
        // response is no longer relevant, and any UNSUB will be accounted for when we
        // sync our SUBs. Without this, users of the client may miss state transitions
        // via callbacks, would have to track the client's internal connection state,
        // and may have to double buffer messages (which we are already doing) if they
        // wanted to ensure their messages reach the server.
        let pong = [] as string[];
        let pend = [] as (string & Buffer)[];
        let pSize = 0;
        let client = this;
        if (client.pending !== null) {
            let pongIndex = 0;
            client.pending.forEach(cmd => {
                let cmdLen = Buffer.isBuffer(cmd) ? cmd.length : Buffer.byteLength(cmd);
                if (cmd === PING_REQUEST && client.pongs !== null && pongIndex < client.pongs.length) {
                    // filter out any useless ping requests (no pong callback, nop flush)
                    let p = client.pongs[pongIndex++];
                    if (p !== undefined) {
                        pend.push(cmd);
                        pSize += cmdLen;
                        pong.push(p);
                    }
                } else if (cmd.length > 3 && cmd[0] === 'P' && cmd[1] === 'U' && cmd[2] === 'B') {
                    pend.push(cmd);
                    pSize += cmdLen;
                }
            });
        }
        this.pongs = pong;
        this.pending = pend;
        this.pSize = pSize;

        this.pstate = ParserState.AWAITING_CONTROL;

        // Clear info processing.
        this.info = {} as ServerInfo;
        this.infoReceived = false;

        // Select a server to connect to.
        this.selectServer();
    };

    /**
     * Close down the stream and clear state.
     *
     * @api private
     */
    private closeStream(): void {
        this.transport.destroy();
        if (this.connected === true || this.closed === true) {
            this.pongs = null;
            this.pout = 0;
            this.pending = null;
            this.pSize = 0;
            this.connected = false;
        }
        this.inbound = null;
    };

    /**
     * Initialize client state.
     *
     * @api private
     */
    private initState(): void {
        this.pending = [];
        this.pout = 0;
    };

    /**
     * Strips all SUBS commands from pending during initial connection completed since
     * we send the subscriptions as a separate operation.
     *
     * @api private
     */
    private stripPendingSubs() {
        if (!this.pending) {
            return;
        }
        let pending = this.pending;
        this.pending = [];
        this.pSize = 0;
        for (let i = 0; i < pending.length; i++) {
            if (!SUBRE.test(pending[i])) {
                // Re-queue the command.
                this.sendCommand(pending[i]);
            }
        }
    }

    /**
     * Sends existing subscriptions to new server after reconnect.
     *
     * @api private
     */
    private sendSubscriptions(): void {
        if (!this.subs || !this.transport.isConnected()) {
            return;
        }

        let protocols = "";
        for (let sid in this.subs) {
            if (this.subs.hasOwnProperty(sid)) {
                let sub = this.subs[sid];
                if (sub.qgroup) {
                    protocols += [SUB, sub.subject, sub.qgroup, sid + CR_LF].join(SPC);
                } else {
                    protocols += [SUB, sub.subject, sid + CR_LF].join(SPC);
                }
            }
        }
        if (protocols.length > 0) {
            this.transport.write(protocols);
        }
    }


    /**
     * Process the inbound data queue.
     *
     * @api private
     */
    private processInbound(): void {
        let client = this;

        // Hold any regex matches.
        let m;

        // For optional yield
        let start;

        if (!client.transport) {
            // if we are here, the stream was reaped and errors raised
            // if we continue.
            return;
        }
        // unpause if needed.
        // FIXME(dlc) client.stream.isPaused() causes 0.10 to fail
        client.transport.resume();

        /* jshint -W083 */

        if (client.options.yieldTime !== undefined) {
            start = Date.now();
        }

        while (!client.closed && client.inbound && client.inbound.length > 0) {
            switch (client.pstate) {

                case ParserState.AWAITING_CONTROL:
                    // Regex only works on strings, so convert once to be more efficient.
                    // Long term answer is a hand rolled parser, not regex.
                    let buf = client.inbound.toString('binary', 0, MAX_CONTROL_LINE_SIZE);
                    if ((m = MSG.exec(buf)) !== null) {
                        client.payload = {
                            subj: m[1],
                            sid: parseInt(m[2], 10),
                            reply: m[4],
                            size: parseInt(m[5], 10)
                        } as Payload;
                        client.payload.psize = client.payload.size + CR_LF_LEN;
                        client.pstate = ParserState.AWAITING_MSG_PAYLOAD;
                    } else if ((m = OK.exec(buf)) !== null) {
                        // Ignore for now..
                    } else if ((m = ERR.exec(buf)) !== null) {
                        client.processErr(m[1]);
                        return;
                    } else if ((m = PONG.exec(buf)) !== null) {
                        client.pout = 0;
                        let cb = client.pongs && client.pongs.shift();
                        if (cb) {
                            cb();
                        } // FIXME: Should we check for exceptions?
                    } else if ((m = PING.exec(buf)) !== null) {
                        client.sendCommand(PONG_RESPONSE);
                    } else if ((m = INFO.exec(buf)) !== null) {
                        client.info = JSON.parse(m[1]);
                        // Check on TLS mismatch.
                        if (client.checkTLSMismatch() === true) {
                            return;
                        }

                        // Always try to read the connect_urls from info
                        let newServers = client.servers.processServerUpdate(client.info);
                        if (newServers.length > 0) {
                            client.emit('serversDiscovered', newServers);
                        }

                        // Process first INFO
                        if (client.infoReceived === false) {
                            // Switch over to TLS as needed.

                            // are we a tls socket?
                            let encrypted = client.transport.isEncrypted();
                            if (client.options.tls !== false && encrypted !== true) {
                                this.transport.upgrade(client.options.tls, function () {
                                    client.flushPending();
                                });
                            }

                            // Send the connect message and subscriptions immediately
                            client.sendConnect();
                            client.sendSubscriptions();

                            client.pongs = client.pongs || [];
                            client.pongs.unshift(function () {
                                client.connectCB();
                            });
                            client.transport.write(PING_REQUEST);

                            // Mark as received
                            client.infoReceived = true;
                            client.stripPendingSubs();
                            client.flushPending();
                        }
                    } else {
                        // FIXME, check line length for something weird.
                        // Nothing here yet, return
                        return;
                    }
                    break;

                case ParserState.AWAITING_MSG_PAYLOAD:
                    if (!client.payload) {
                        break;
                    }

                    // If we do not have the complete message, hold onto the chunks
                    // and assemble when we have all we need. This optimizes for
                    // when we parse a large buffer down to a small number of bytes,
                    // then we receive a large chunk. This avoids a big copy with a
                    // simple concat above.
                    if (client.inbound.length < client.payload.psize) {
                        if (undefined === client.payload.chunks) {
                            client.payload.chunks = [];
                        }
                        client.payload.chunks.push(client.inbound);
                        client.payload.psize -= client.inbound.length;
                        client.inbound = null;
                        return;
                    }

                    // If we are here we have the complete message.
                    // Check to see if we have existing chunks
                    if (client.payload.chunks) {

                        client.payload.chunks.push(client.inbound.slice(0, client.payload.psize));
                        // don't append trailing control characters
                        let mbuf = Buffer.concat(client.payload.chunks, client.payload.size);

                        if (client.options.preserveBuffers) {
                            client.payload.msg = mbuf;
                        } else {
                            client.payload.msg = mbuf.toString(client.encoding);
                        }

                    } else {

                        if (client.options.preserveBuffers) {
                            client.payload.msg = client.inbound.slice(0, client.payload.size);
                        } else {
                            client.payload.msg = client.inbound.toString(client.encoding, 0, client.payload.size);
                        }

                    }

                    // Eat the size of the inbound that represents the message.
                    if (client.inbound.length === client.payload.psize) {
                        client.inbound = null;
                    } else {
                        client.inbound = client.inbound.slice(client.payload.psize);
                    }

                    // process the message
                    client.processMsg();

                    // Reset
                    client.pstate = ParserState.AWAITING_CONTROL;
                    client.payload = null;

                    // Check to see if we have an option to yield for other events after yieldTime.
                    if (start !== undefined && client.options && client.options.yieldTime) {
                        if ((Date.now() - start) > client.options.yieldTime) {
                            client.transport.pause();
                            setImmediate(client.processInbound.bind(this));
                            return;
                        }
                    }
                    break;
            }

            // This is applicable for a regex match to eat the bytes we used from a control line.
            if (m && !this.closed && client.inbound) {
                // Chop inbound
                let psize = m[0].length;
                if (psize >= client.inbound.length) {
                    client.inbound = null;
                } else {
                    client.inbound = client.inbound.slice(psize);
                }
            }
            m = null;
        }
    }

    /**
     * Check for TLS configuration mismatch.
     *
     * @api private
     */
    private checkTLSMismatch(): boolean {
        if (this.info.tls_required === true &&
            this.options.tls === false) {
            this.emit('error', NatsError.errorForCode(ErrorCode.SECURE_CONN_REQ));
            this.closeStream();
            return true;
        }

        if (this.info.tls_required === false &&
            this.options.tls !== false) {
            this.emit('error', NatsError.errorForCode(ErrorCode.NON_SECURE_CONN_REQ));
            this.closeStream();
            return true;
        }


        let cert = false;
        if (this.options.tls && typeof this.options.tls === 'object') {
            cert = this.options.tls.cert != null;
        }
        if (this.info.tls_verify === true && !cert) {
            this.emit('error', NatsError.errorForCode(ErrorCode.CLIENT_CERT_REQ));
            this.closeStream();
            return true;
        }
        return false;
    }


    /**
     * Process a delivered message and deliver to appropriate subscriber.
     *
     * @api private
     */
    private processMsg(): void {
        if (!this.subs || !this.payload) {
            return;
        }
        let sub = this.subs[this.payload.sid];
        if (!sub) {
            return;
        }
        sub.received += 1;
        // Check for a timeout, and cancel if received >= expected
        if (sub.timeout) {
            if (sub.expected !== undefined && sub.received >= sub.expected) {
                clearTimeout(sub.timeout);
                sub.timeout = null;
            }
        }
        // Check for auto-unsubscribe
        if (sub.max !== undefined) {
            if (sub.received === sub.max) {
                delete this.subs[this.payload.sid];
                this.emit('unsubscribe', this.payload.sid, sub.subject);
            } else if (sub.received > sub.max) {
                this.unsubscribe(this.payload.sid);
                sub.callback = null;
            }
        }

        if (sub.callback) {
            let msg = this.payload.msg;
            if (this.options.json && msg) {
                if (msg instanceof Buffer) {
                    msg = msg.toString(this.options.encoding);
                }
                try {
                    msg = JSON.parse(msg);
                } catch (e) {
                    msg = e;
                }
            }
            sub.callback(msg, this.payload.reply, this.payload.subj, this.payload.sid);
        }
    };


    /**
     * ProcessErr processes any error messages from the server
     *
     * @api private
     */
    private processErr(s: string): void {
        // current NATS clients, will raise an error and close on any errors
        // except stale connection and permission errors
        let m = s ? s.toLowerCase() : '';
        if (m.indexOf(PERMISSIONS_ERR) !== -1) {
            // closeStream() triggers a reconnect if allowed
            this.closeStream();
        } else if (m.indexOf(PERMISSIONS_ERR) !== -1) {
            this.emit('permission_error', new NatsError(s, ErrorCode.NATS_PROTOCOL_ERR));
        } else {
            this.emit('error', new NatsError(s, ErrorCode.NATS_PROTOCOL_ERR));
            this.closeStream();
        }
    };


    /**
     * Reconnect to the server.
     *
     * @api private
     */
    private reconnect(): void {
        if (this.closed) {
            return;
        }
        this.reconnects += 1;
        this.prepareConnection();
        if (this.currentServer.didConnect === true) {
            this.emit('reconnecting');
        }
    }

    /**
     * Setup a timer event to attempt reconnect.
     *
     * @api private
     */
    private scheduleReconnect(): void {
        let ph = this;
        // Just return if no more servers
        if (ph.servers.length() === 0) {
            return;
        }
        // Don't set reconnecting state if we are just trying
        // for the first time.
        if (ph.wasConnected === true) {
            ph.reconnecting = true;
        }
        // Only stall if we have connected before.
        let wait = 0;
        let s = ph.servers.next();
        if (s && s.didConnect === true && this.options.reconnectTimeWait !== undefined) {
            wait = this.options.reconnectTimeWait;
        }
        setTimeout(() => {
            ph.reconnect();
        }, wait);
    }

    private scheduleHeartbeat(): void {
        this.pingTimer = setTimeout(() => {
            this.client.emit('pingtimer');
            if (this.closed) {
                return;
            }
            // we could be waiting on the socket to connect
            if (this.transport.isConnected()) {
                this.client.emit('pingcount', this.pout);
                this.pout++;
                if (this.pout > this.options.maxPingOut) {
                    // processErr will scheduleReconnect
                    this.processErr(STALE_CONNECTION_ERR);
                    // don't reschedule, new connection initiated
                    return;
                } else {
                    // send the ping
                    this.sendCommand(PING_REQUEST);
                    if (this.pongs) {
                        // no callback
                        this.pongs.push(undefined);
                    }

                }
            }
            // reschedule
            this.scheduleHeartbeat();
        }, this.options.pingInterval || DEFAULT_PING_INTERVAL, this);
    }

    /**
     * Callback for first flush/connect.
     *
     * @api private
     */
    private connectCB(): void {
        let event = this.reconnecting ? 'reconnect' : 'connect';
        this.reconnecting = false;
        this.reconnects = 0;
        this.wasConnected = true;
        if (this.currentServer) {
            this.currentServer.didConnect = true;
        }
        this.emit(event, this);
        this.flushPending();
    }

    /**
     * Properly select the next server.
     * We rotate the server list as we go,
     * we also pull auth from urls as needed, or
     * if they were set in options use that as override.
     *
     * @api private
     */
    private selectServer(): void {
        let server = this.servers.selectServer();
        if (server === undefined) {
            return;
        }

        // Place in client context.
        this.currentServer = server;
        this.url = server.url;
        let auth = server.getCredentials();
        if (auth) {
            if (auth.length !== 1) {
                if (this.options.user === undefined) {
                    this.user = auth[0];
                }
                if (this.options.pass === undefined) {
                    this.pass = auth[1];
                }
            } else if (this.options.token === undefined) {
                this.token = auth[0];
            }
        }
    }


    numSubscriptions(): number {
        if (this.subs) {
            return Object.keys(this.subs).length;
        }
        return 0;
    }



}